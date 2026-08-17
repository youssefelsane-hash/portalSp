import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { CancelWorkerBookingDto } from './dto/cancel-worker-booking.dto';
import { CreateWorkerBookingDto } from './dto/create-worker-booking.dto';
import { DomesticWorkerBooking, DomesticWorkerBookingStatus, DomesticWorkerBookingType } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from './entities/domestic-worker-earning-approval.entity';
import { DomesticWorkerProfile, DomesticWorkerVerificationStatus } from './entities/domestic-worker-profile.entity';
import { DomesticWorkersService } from './domestic-workers.service';

const SWEEP_INTERVAL_MS = 60_000;
const COMMISSION_PERCENTAGE_FALLBACK = 15;
const SWEEP_BATCH_SIZE = 25;

/**
 * حجوزات قطاع الخدمات المنزلية (docs/08 §12، ADR-0004) — دفع حقيقي عبر WalletsService.doubleEntry
 * الموجودة (نفس آلية payWithWallet/settleAndComplete)، مش نظام دفع مواز مختلق.
 *
 * **التجديد الشهري التلقائي عبر فحص دوري (setInterval)، مش BullMQ** — نفس فلسفة
 * OrderAutoCancelService/RecurringOrdersService بالحرف (تفادي الاعتماد على Worker عنده بَقّة
 * recovery موثّقة بعد انقطاع Redis طويل).
 */
@Injectable()
export class DomesticWorkerBookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomesticWorkerBookingsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(DomesticWorkerBooking) private readonly bookings: Repository<DomesticWorkerBooking>,
    @InjectRepository(DomesticWorkerProfile) private readonly profiles: Repository<DomesticWorkerProfile>,
    @InjectRepository(DomesticWorkerEarningApproval) private readonly earningApprovals: Repository<DomesticWorkerEarningApproval>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly workersService: DomesticWorkersService,
    private readonly walletsService: WalletsService,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل sweep تجديد حجوزات الخدمات المنزلية', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(userId: string, dto: CreateWorkerBookingDto): Promise<DomesticWorkerBooking> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const worker = await this.workersService.findByIdOrThrow(dto.worker_id);

    if (worker.verificationStatus !== DomesticWorkerVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    if (!worker.specialties.includes(dto.specialty)) {
      throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة ده مش متخصص في الخدمة دي', HttpStatus.BAD_REQUEST);
    }

    const scheduledAt = new Date(dto.scheduled_at);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new ApiException(ErrorCode.VAL_001, 'الموعد لازم يكون في المستقبل', HttpStatus.BAD_REQUEST);
    }

    let priceCents: number;
    if (dto.booking_type === DomesticWorkerBookingType.HOURLY) {
      if (!dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد عدد الساعات', HttpStatus.BAD_REQUEST);
      }
      if (!worker.hourlyRateCents) {
        throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة ده مالوش سعر بالساعة محدد', HttpStatus.BAD_REQUEST);
      }
      priceCents = worker.hourlyRateCents * dto.duration_hours;
    } else {
      if (!worker.monthlyRateCents) {
        throw new ApiException(ErrorCode.VAL_001, 'مقدّم الخدمة ده مالوش سعر شهري محدد', HttpStatus.BAD_REQUEST);
      }
      priceCents = worker.monthlyRateCents;
    }

    const [{ next_human_readable_number: bookingNumber }] = await this.bookings.manager.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('DWB')");

    const booking = this.bookings.create({
      bookingNumber,
      customerId: customerProfile.id,
      workerId: worker.id,
      addressId: dto.address_id,
      specialty: dto.specialty,
      bookingType: dto.booking_type,
      scheduledAt,
      durationHours: dto.booking_type === DomesticWorkerBookingType.HOURLY ? dto.duration_hours : null,
      autoRenew: dto.booking_type === DomesticWorkerBookingType.MONTHLY_LIVE_IN ? (dto.auto_renew ?? false) : false,
      priceCents,
      customerNotes: dto.customer_notes ?? null,
    });
    return this.bookings.save(booking);
  }

  private async findOwnedByCustomerOrThrow(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const booking = await this.bookings.findOne({ where: { id: bookingId, customerId: customerProfile.id } });
    if (!booking) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز غير موجود', HttpStatus.NOT_FOUND);
    }
    return booking;
  }

  private async findOwnedByWorkerOrThrow(userId: string, bookingId: string): Promise<{ booking: DomesticWorkerBooking; worker: DomesticWorkerProfile }> {
    const worker = await this.workersService.findByUserIdOrThrow(userId);
    const booking = await this.bookings.findOne({ where: { id: bookingId, workerId: worker.id } });
    if (!booking) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return { booking, worker };
  }

  listForCustomer(userId: string): Promise<DomesticWorkerBooking[]> {
    return this.customerProfiles
      .findByUserIdOrThrow(userId)
      .then((profile) => this.bookings.find({ where: { customerId: profile.id }, order: { createdAt: 'DESC' } }));
  }

  listForWorker(userId: string): Promise<DomesticWorkerBooking[]> {
    return this.workersService
      .findByUserIdOrThrow(userId)
      .then((worker) => this.bookings.find({ where: { workerId: worker.id }, order: { createdAt: 'DESC' } }));
  }

  private async commissionPercentage(): Promise<number> {
    return this.settingsService.getNumber('commission.domestic_worker_percentage', COMMISSION_PERCENTAGE_FALLBACK);
  }

  /**
   * الشغالة/المربية بتأكّد الحجز → تحصيل السعر فورًا من محفظة العميل لمحفظة المنصة (زي
   * payWithWallet بالظبط). **أرباح الشغالة نفسها متتحوّلش هنا خالص** (docs/08 §25.1، قرار مالك
   * صريح 2026-08-15) — بالساعة بتدخل طابور الموافقة بعد `completeHourly()` (اكتمال الزيارة
   * الفعلي)؛ شهري (مفيش إشارة "الشهر اتخدم" منفصلة عن التجديد في النظام الحالي) بتدخل الطابور هنا
   * وفي كل تجديد (`tryRenew`) — بس برضه pending مش رصيد قابل للصرف فورًا، راجع
   * DomesticWorkerEarningApprovalsService.approve() للمسار الوحيد اللي بيحرّك الفلوس فعليًا.
   */
  async confirm(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const { booking, worker } = await this.findOwnedByWorkerOrThrow(userId, bookingId);
    if (booking.status !== DomesticWorkerBookingStatus.PENDING_CONFIRMATION) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز مش في حالة انتظار تأكيد', HttpStatus.CONFLICT);
    }

    const split = await this.commissionSplit(booking.priceCents);
    return this.dataSource.transaction(async (manager) => {
      const lockedBooking = await manager
        .createQueryBuilder(DomesticWorkerBooking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :bookingId', { bookingId })
        .getOne();
      if (!lockedBooking || lockedBooking.status !== DomesticWorkerBookingStatus.PENDING_CONFIRMATION) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز مش في حالة انتظار تأكيد', HttpStatus.CONFLICT);
      }
      const customerProfile = await manager.getRepository(CustomerProfile).findOne({ where: { id: lockedBooking.customerId } });
      if (!customerProfile) {
        throw new ApiException(ErrorCode.VAL_001, 'ملف العميل غير موجود', HttpStatus.NOT_FOUND);
      }

      const now = new Date();
      if (lockedBooking.bookingType === DomesticWorkerBookingType.HOURLY) {
        await this.chargeCustomerInTransaction(manager, lockedBooking, customerProfile.userId);
        lockedBooking.status = DomesticWorkerBookingStatus.CONFIRMED;
      } else {
        const periodEnd = addMonths(lockedBooking.scheduledAt.getTime() > now.getTime() ? lockedBooking.scheduledAt : now, 1);
        await this.chargeCustomerAndCreatePendingEarningInTransaction(
          manager,
          lockedBooking,
          customerProfile.userId,
          worker.userId,
          split.workerEarningCents,
          `monthly:${periodEnd.toISOString()}`,
        );
        lockedBooking.status = DomesticWorkerBookingStatus.ACTIVE;
        lockedBooking.currentPeriodEndAt = periodEnd;
      }
      lockedBooking.confirmedAt = now;
      return manager.save(lockedBooking);
    });
  }

  private async commissionSplit(priceCents: number): Promise<{ platformCommissionCents: number; workerEarningCents: number }> {
    const commissionPercentage = await this.commissionPercentage();
    const platformCommissionCents = Math.round((priceCents * commissionPercentage) / 100);
    return { platformCommissionCents, workerEarningCents: priceCents - platformCommissionCents };
  }

  /** خصم من محفظة العميل لمحفظة المنصة بس — صفر تحويل لأي شغالة هنا. */
  private async chargeCustomerInTransaction(
    manager: EntityManager,
    booking: DomesticWorkerBooking,
    customerUserId: string,
  ): Promise<void> {
    const customerWallet = await this.walletsService.getOrCreateWallet(customerUserId, WalletOwnerType.CUSTOMER, manager);
    const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
    await this.walletsService.doubleEntry(
      {
        fromWalletId: customerWallet.id,
        toWalletId: platformWallet.id,
        amountCents: booking.priceCents,
        transactionType: WalletTxType.ADJUSTMENT,
        referenceType: 'domestic_worker_booking',
        referenceId: booking.id,
        descriptionAr: `دفع حجز خدمة منزلية ${booking.bookingNumber}`,
      },
      manager,
    );
  }

  /**
   * خصم العميل + تسجيل استحقاق الشغالة كـ"pending" جوّه transaction واحدة (نفس درس البَقّة
   * القديمة — الاتنين لازم يفشلوا أو ينجحوا مع بعض، مش نداءين منفصلين). صفر تحويل مباشر لمحفظة
   * الشغالة هنا — بس صف طابور موافقة، راجع docs/08 §25.1.
   */
  private async chargeCustomerAndCreatePendingEarningInTransaction(
    manager: EntityManager,
    booking: DomesticWorkerBooking,
    customerUserId: string,
    workerUserId: string,
    workerEarningCents: number,
    sourceKey: string,
  ): Promise<void> {
    await this.chargeCustomerInTransaction(manager, booking, customerUserId);
    if (workerEarningCents > 0) {
      await manager.getRepository(DomesticWorkerEarningApproval).save(
        manager.getRepository(DomesticWorkerEarningApproval).create({
          bookingId: booking.id,
          workerUserId,
          sourceKey,
          amountCents: workerEarningCents,
          status: DomesticWorkerEarningApprovalStatus.PENDING,
        }),
      );
    }
  }

  /** الشغالة بتقفل حجز بالساعة بعد ما تخلّص الزيارة — هنا بس (اكتمال حقيقي) بيتسجّل استحقاقها كـ"pending". */
  async completeHourly(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const { booking, worker } = await this.findOwnedByWorkerOrThrow(userId, bookingId);
    if (booking.bookingType !== DomesticWorkerBookingType.HOURLY) {
      throw new ApiException(ErrorCode.VAL_001, 'دي مش زيارة بالساعة', HttpStatus.BAD_REQUEST);
    }
    if (booking.status !== DomesticWorkerBookingStatus.CONFIRMED) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز لازم يكون مؤكّد الأول', HttpStatus.CONFLICT);
    }

    const { workerEarningCents } = await this.commissionSplit(booking.priceCents);

    const completedBooking = await this.dataSource.transaction(async (manager) => {
      const lockedBooking = await manager
        .createQueryBuilder(DomesticWorkerBooking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :bookingId', { bookingId })
        .getOne();
      if (!lockedBooking || lockedBooking.status !== DomesticWorkerBookingStatus.CONFIRMED) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز لازم يكون مؤكّد الأول', HttpStatus.CONFLICT);
      }
      lockedBooking.status = DomesticWorkerBookingStatus.COMPLETED;
      lockedBooking.completedAt = new Date();
      await manager.save(lockedBooking);

      const lockedWorker = await manager
        .createQueryBuilder(DomesticWorkerProfile, 'worker')
        .setLock('pessimistic_write')
        .where('worker.id = :workerId', { workerId: worker.id })
        .getOneOrFail();
      lockedWorker.completedBookingsCount += 1;
      await manager.save(lockedWorker);

      if (workerEarningCents > 0) {
        await manager.getRepository(DomesticWorkerEarningApproval).save(
          manager.getRepository(DomesticWorkerEarningApproval).create({
            bookingId: lockedBooking.id,
            workerUserId: worker.userId,
            sourceKey: 'hourly-completion',
            amountCents: workerEarningCents,
            status: DomesticWorkerEarningApprovalStatus.PENDING,
          }),
        );
      }
      return lockedBooking;
    });

    return completedBooking;
  }

  async cancel(userId: string, bookingId: string, dto: CancelWorkerBookingDto): Promise<DomesticWorkerBooking> {
    const ownedBooking = await this.findOwnedByCustomerOrThrow(userId, bookingId);
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager
        .createQueryBuilder(DomesticWorkerBooking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :bookingId', { bookingId: ownedBooking.id })
        .getOne();
      if (!booking || booking.status === DomesticWorkerBookingStatus.COMPLETED || booking.status === DomesticWorkerBookingStatus.CANCELLED) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز ده مش قابل للإلغاء دلوقتي', HttpStatus.CONFLICT);
      }

      const pendingApprovals = await manager
        .createQueryBuilder(DomesticWorkerEarningApproval, 'approval')
        .setLock('pessimistic_write')
        .where('approval.booking_id = :bookingId', { bookingId: booking.id })
        .andWhere('approval.status = :status', { status: DomesticWorkerEarningApprovalStatus.PENDING })
        .orderBy('approval.id', 'ASC')
        .getMany();
      for (const approval of pendingApprovals) {
        approval.status = DomesticWorkerEarningApprovalStatus.INVALIDATED;
        approval.rejectionReason = `أُلغي الحجز قبل اعتماد الاستحقاق${dto.reason ? `: ${dto.reason}` : ''}`;
        approval.reviewedAt = new Date();
        await manager.save(approval);
      }

      // مفيش استرداد جزئي في v1 لو الحجز اتأكد بالفعل؛ لكن أي استحقاق لم يُعتمد يُبطل ذريًا.
      booking.status = DomesticWorkerBookingStatus.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancellationReason = dto.reason ?? null;
      booking.autoRenew = false;
      return manager.save(booking);
    });
  }

  async sweep(): Promise<{ renewed: number; expired: number }> {
    const now = new Date();

    const dueForRenewal = await this.bookings.find({
      where: {
        status: DomesticWorkerBookingStatus.ACTIVE,
        bookingType: DomesticWorkerBookingType.MONTHLY_LIVE_IN,
        autoRenew: true,
        currentPeriodEndAt: LessThanOrEqual(now),
      },
      order: { currentPeriodEndAt: 'ASC' },
      take: SWEEP_BATCH_SIZE,
    });
    let renewed = 0;
    for (const booking of dueForRenewal) {
      const ok = await this.tryRenew(booking.id, booking.currentPeriodEndAt!, now);
      if (ok) renewed++;
    }

    // عقود شهرية وصلت لنهاية فترتها من غير تجديد (auto_renew=false، سواء من الأول أو بعد فشل
    // تجديد) — بتقفل completed، مش تفضل active للأبد.
    const dueForExpiry = await this.bookings.find({
      where: {
        status: DomesticWorkerBookingStatus.ACTIVE,
        bookingType: DomesticWorkerBookingType.MONTHLY_LIVE_IN,
        autoRenew: false,
        currentPeriodEndAt: LessThanOrEqual(now),
      },
      order: { currentPeriodEndAt: 'ASC' },
      take: SWEEP_BATCH_SIZE,
    });
    let expired = 0;
    for (const booking of dueForExpiry) {
      const result = await this.bookings
        .createQueryBuilder()
        .update(DomesticWorkerBooking)
        .set({ status: DomesticWorkerBookingStatus.COMPLETED, completedAt: now })
        .where('id = :id', { id: booking.id })
        .andWhere('status = :status', { status: DomesticWorkerBookingStatus.ACTIVE })
        .andWhere('auto_renew = false')
        .andWhere('current_period_end_at <= :now', { now })
        .execute();
      expired += result.affected ?? 0;
    }
    if (renewed > 0 || expired > 0) {
      this.logger.log(`حجوزات الخدمات المنزلية: ${renewed} تجديد ناجح، ${expired} عقد انتهى`);
    }
    return { renewed, expired };
  }

  /** فشل دفع/بيانات نهائي يوقف التجديد؛ خطأ بنية عابر يظل مستحقًا كي تعيده الدورة التالية. */
  private async tryRenew(bookingId: string, expectedPeriodEnd: Date, now: Date): Promise<boolean> {
    const commissionPercentage = await this.commissionPercentage();
    try {
      return await this.dataSource.transaction(async (manager) => {
        const booking = await manager
          .createQueryBuilder(DomesticWorkerBooking, 'booking')
          .setLock('pessimistic_write')
          .where('booking.id = :bookingId', { bookingId })
          .getOne();
        if (
          !booking ||
          booking.status !== DomesticWorkerBookingStatus.ACTIVE ||
          booking.bookingType !== DomesticWorkerBookingType.MONTHLY_LIVE_IN ||
          !booking.autoRenew ||
          !booking.currentPeriodEndAt ||
          booking.currentPeriodEndAt.getTime() !== expectedPeriodEnd.getTime() ||
          booking.currentPeriodEndAt.getTime() > now.getTime()
        ) {
          return false;
        }

        const worker = await manager.getRepository(DomesticWorkerProfile).findOne({ where: { id: booking.workerId } });
        const customerProfile = await manager.getRepository(CustomerProfile).findOne({ where: { id: booking.customerId } });
        if (!worker || !customerProfile) {
          throw new ApiException(ErrorCode.VAL_001, 'بيانات طرفي الحجز غير مكتملة', HttpStatus.CONFLICT);
        }
        const platformCommissionCents = Math.round((booking.priceCents * commissionPercentage) / 100);
        const nextPeriodEnd = addMonths(booking.currentPeriodEndAt, 1);
        await this.chargeCustomerAndCreatePendingEarningInTransaction(
          manager,
          booking,
          customerProfile.userId,
          worker.userId,
          booking.priceCents - platformCommissionCents,
          `monthly:${nextPeriodEnd.toISOString()}`,
        );
        booking.currentPeriodEndAt = nextPeriodEnd;
        await manager.save(booking);
        return true;
      });
    } catch (err) {
      const terminalBusinessFailure = err instanceof ApiException;
      this.logger.warn(
        `فشل تجديد حجز ${bookingId} — ${terminalBusinessFailure ? 'إيقاف auto_renew' : 'سيُعاد في الدورة التالية'}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      if (!terminalBusinessFailure) return false;
      await this.dataSource.transaction(async (manager) => {
        const booking = await manager
          .createQueryBuilder(DomesticWorkerBooking, 'booking')
          .setLock('pessimistic_write')
          .where('booking.id = :bookingId', { bookingId })
          .getOne();
        if (
          booking?.status === DomesticWorkerBookingStatus.ACTIVE &&
          booking.autoRenew &&
          booking.currentPeriodEndAt?.getTime() === expectedPeriodEnd.getTime()
        ) {
          booking.autoRenew = false;
          await manager.save(booking);
        }
      });
      return false;
    }
  }
}

// كانت بَقّة حقيقية (نفس فئة البَقّة في recurring-orders.service.ts's nextOccurrence): `setMonth`
// بيفيض بصمت لو اليوم مش موجود في الشهر الجديد (31 يناير + شهر → JS بتحسبها "31 فبراير" فتتدحرج
// لـ3 مارس بدل آخر يوم في فبراير). الإصلاح: نحسب على "اليوم 1" الأول (مفيش فيضان)، وبعدين نـclamp
// اليوم المطلوب لآخر يوم فعلي في الشهر الجديد.
function addMonths(from: Date | number, months: number): Date {
  const base = new Date(from);
  const year = base.getUTCFullYear();
  const monthIndex0 = base.getUTCMonth() + months;
  const day = base.getUTCDate();
  const lastDayOfNewMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const next = new Date(base);
  next.setUTCFullYear(year, monthIndex0, Math.min(day, lastDayOfNewMonth));
  return next;
}
