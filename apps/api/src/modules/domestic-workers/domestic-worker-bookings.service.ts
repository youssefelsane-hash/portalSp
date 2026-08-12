import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { CancelWorkerBookingDto } from './dto/cancel-worker-booking.dto';
import { CreateWorkerBookingDto } from './dto/create-worker-booking.dto';
import { DomesticWorkerBooking, DomesticWorkerBookingStatus, DomesticWorkerBookingType } from './entities/domestic-worker-booking.entity';
import { DomesticWorkerProfile, DomesticWorkerVerificationStatus } from './entities/domestic-worker-profile.entity';
import { DomesticWorkersService } from './domestic-workers.service';

const SWEEP_INTERVAL_MS = 60_000;
const COMMISSION_PERCENTAGE_FALLBACK = 15;

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
   * payWithWallet بالظبط)، وأرباحها بتتحوّل فورًا كمان (بالساعة: العمولة بتتحصّل مرة واحدة هنا
   * لأن مفيش "اكتمال" منفصل ماليًا؛ شهري: أول شهر بيتحصّل هنا، الباقي عبر sweep()).
   */
  async confirm(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const { booking, worker } = await this.findOwnedByWorkerOrThrow(userId, bookingId);
    if (booking.status !== DomesticWorkerBookingStatus.PENDING_CONFIRMATION) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز مش في حالة انتظار تأكيد', HttpStatus.CONFLICT);
    }

    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(booking.customerId);
    await this.chargeCustomerAndPayWorker(booking, customerProfile.userId, worker.userId);

    const now = new Date();
    booking.status = booking.bookingType === DomesticWorkerBookingType.HOURLY
      ? DomesticWorkerBookingStatus.CONFIRMED
      : DomesticWorkerBookingStatus.ACTIVE;
    booking.confirmedAt = now;
    if (booking.bookingType === DomesticWorkerBookingType.MONTHLY_LIVE_IN) {
      booking.currentPeriodEndAt = addMonths(booking.scheduledAt.getTime() > now.getTime() ? booking.scheduledAt : now, 1);
    }
    return this.bookings.save(booking);
  }

  /** خصم من محفظة العميل + إيداع لمحفظة الشغالة (بعد خصم عمولة المنصة) — جوّه transaction واحدة. */
  private async chargeCustomerAndPayWorker(booking: DomesticWorkerBooking, customerUserId: string, workerUserId: string): Promise<void> {
    const commissionPercentage = await this.commissionPercentage();
    const platformCommissionCents = Math.round((booking.priceCents * commissionPercentage) / 100);
    const workerEarningCents = booking.priceCents - platformCommissionCents;

    const customerWallet = await this.walletsService.getOrCreateWallet(customerUserId, WalletOwnerType.CUSTOMER);
    const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const workerWallet = await this.walletsService.getOrCreateWallet(workerUserId, WalletOwnerType.DOMESTIC_WORKER);

    await this.walletsService.doubleEntry({
      fromWalletId: customerWallet.id,
      toWalletId: platformWallet.id,
      amountCents: booking.priceCents,
      transactionType: WalletTxType.ADJUSTMENT,
      referenceType: 'domestic_worker_booking',
      referenceId: booking.id,
      descriptionAr: `دفع حجز خدمة منزلية ${booking.bookingNumber}`,
    });

    if (workerEarningCents > 0) {
      await this.walletsService.doubleEntry({
        fromWalletId: platformWallet.id,
        toWalletId: workerWallet.id,
        amountCents: workerEarningCents,
        transactionType: WalletTxType.ORDER_EARNING,
        referenceType: 'domestic_worker_booking',
        referenceId: booking.id,
        descriptionAr: `أرباح حجز خدمة منزلية ${booking.bookingNumber}`,
        // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود — نفس السبب بالحرف في
        // payments.service.ts's settleAndComplete (تحويل أرباح الفني).
        allowNegativeBalance: true,
      });
    }
  }

  /** الشغالة بتقفل حجز بالساعة بعد ما تخلّص الزيارة — مفيش تحصيل هنا (اتحصّل وقت التأكيد). */
  async completeHourly(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const { booking, worker } = await this.findOwnedByWorkerOrThrow(userId, bookingId);
    if (booking.bookingType !== DomesticWorkerBookingType.HOURLY) {
      throw new ApiException(ErrorCode.VAL_001, 'دي مش زيارة بالساعة', HttpStatus.BAD_REQUEST);
    }
    if (booking.status !== DomesticWorkerBookingStatus.CONFIRMED) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز لازم يكون مؤكّد الأول', HttpStatus.CONFLICT);
    }
    booking.status = DomesticWorkerBookingStatus.COMPLETED;
    booking.completedAt = new Date();
    await this.bookings.save(booking);

    worker.completedBookingsCount += 1;
    await this.profiles.save(worker);

    return booking;
  }

  async cancel(userId: string, bookingId: string, dto: CancelWorkerBookingDto): Promise<DomesticWorkerBooking> {
    const booking = await this.findOwnedByCustomerOrThrow(userId, bookingId);
    if (booking.status === DomesticWorkerBookingStatus.COMPLETED || booking.status === DomesticWorkerBookingStatus.CANCELLED) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز ده مش قابل للإلغاء دلوقتي', HttpStatus.CONFLICT);
    }
    // مفيش استرداد جزئي في v1 لو الحجز اتأكد بالفعل (اتحصّل فعلاً) — قرار متعمّد، سياسة استرداد
    // مفصّلة مش موجودة في المصدر الأصلي لهذا القطاع تحديداً، نفس منطق عدم اختراع أرقام غير موثّقة.
    booking.status = DomesticWorkerBookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancellationReason = dto.reason ?? null;
    booking.autoRenew = false;
    return this.bookings.save(booking);
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
    });
    let renewed = 0;
    for (const booking of dueForRenewal) {
      const ok = await this.tryRenew(booking);
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
    });
    for (const booking of dueForExpiry) {
      booking.status = DomesticWorkerBookingStatus.COMPLETED;
      booking.completedAt = now;
      await this.bookings.save(booking);
    }
    if (renewed > 0 || dueForExpiry.length > 0) {
      this.logger.log(`حجوزات الخدمات المنزلية: ${renewed} تجديد ناجح، ${dueForExpiry.length} عقد انتهى`);
    }
    return { renewed, expired: dueForExpiry.length };
  }

  /** فشل التجديد (رصيد غير كافٍ عادة) بيوقف auto_renew — مفيش إعادة محاولة لا نهائية، نفس أي اشتراك حقيقي. */
  private async tryRenew(booking: DomesticWorkerBooking): Promise<boolean> {
    const worker = await this.profiles.findOne({ where: { id: booking.workerId } });
    if (!worker) return false;
    const customerProfile = await this.customerProfiles.findByProfileIdOrThrow(booking.customerId);

    try {
      await this.chargeCustomerAndPayWorker(booking, customerProfile.userId, worker.userId);
      booking.currentPeriodEndAt = addMonths(booking.currentPeriodEndAt ?? new Date(), 1);
      await this.bookings.save(booking);
      return true;
    } catch (err) {
      this.logger.warn(`فشل تجديد حجز ${booking.bookingNumber} — إيقاف auto_renew: ${err instanceof Error ? err.message : err}`);
      booking.autoRenew = false;
      await this.bookings.save(booking);
      return false;
    }
  }
}

function addMonths(from: Date | number, months: number): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
}
