import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  DOMESTIC_WORKER_BOOKING_PAYMENT_CONFIRMED_EVENT,
  DomesticWorkerBookingPaymentConfirmedEvent,
} from '../../common/events/domestic-worker-booking-payment-confirmed.event';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Payment, PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { PaymentsService } from '../payments/payments.service';
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
 * حجوزات قطاع الخدمات المنزلية (docs/08 §12، ADR-0004) — الدفع عبر تدفق InstaPay اليدوي الموجود
 * فعلاً لطلبات orders، مُعاد استخدامه بالكامل عبر `PaymentsService` (docs/adr/0019، توجيه صريح من
 * المالك 2026-08-20) — مش نظام دفع مواز مختلق. موافقة الشغالة (`confirm()`) مستقلة تمامًا عن
 * الدفع؛ الحجز بينتقل لـ`awaiting_payment` وبعدين العميل بيدفع InstaPay، والأدمن بيأكّد/يرفض عبر
 * نفس `POST /admin/payments/:id/confirm-instapay`/`reject-instapay` بتاعة الطلبات بالحرف.
 *
 * **التجديد الشهري التلقائي عبر فحص دوري (setInterval)، مش BullMQ** — نفس فلسفة
 * OrderAutoCancelService/RecurringOrdersService بالحرف (تفادي الاعتماد على Worker عنده بَقّة
 * recovery موثّقة بعد انقطاع Redis طويل). بقى بيحوّل العقد لـ`awaiting_payment` بدل خصم صامت —
 * تجديد شهري بقى محتاج نفس دورة الدفع اليدوي زي التأكيد الأول بالظبط.
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
    private readonly paymentsService: PaymentsService,
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

  /**
   * ظهور الحجوزات للأدمن (docs/adr/0019 §6 — كل مرحلة لازم تبان للأدمن) — أهم استخدام: لقاء
   * الحجوزات `awaiting_payment` عشان الأدمن يعرف يدوّر على دفعة InstaPay المرتبطة (عبر
   * `payment.domestic_worker_booking_id`) ويأكّدها. **فجوة UI موثّقة صراحة**: مفيش صفحة Next.js
   * في apps/admin لسه بتستهلك الـendpoint ده — راجع domestic-workers/README.md.
   */
  listForAdmin(status?: DomesticWorkerBookingStatus): Promise<DomesticWorkerBooking[]> {
    return this.bookings.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } });
  }

  private async commissionPercentage(): Promise<number> {
    return this.settingsService.getNumber('commission.domestic_worker_percentage', COMMISSION_PERCENTAGE_FALLBACK);
  }

  /**
   * الشغالة/المربية بتوافق على الحجز — **بلا أي تحصيل خالص** (توجيه صريح من المالك 2026-08-20،
   * docs/adr/0019: "Worker acceptance must be independent from payment"). الحجز بينتقل لـ
   * `awaiting_payment` بس؛ العميل هو اللي بيبدأ دفع InstaPay بعد كده
   * (`PaymentsService.payDomesticWorkerBookingWithInstaPay`)، وتأكيد الدفع الإداري
   * (`PaymentsService.confirmInstaPayPayment`) هو اللي بيحوّل الحجز فعليًا لـ`confirmed`/`active`.
   * **بَقّة حقيقية كانت هنا واتصلحت**: كان بيحصّل السعر فورًا من محفظة العميل، ومفيش أي آلية شحن
   * محفظة (top-up) في المنصة كلها — يعني أي عميل بلا رصيد سابق كان مستحيل يدفع تمامًا.
   */
  async confirm(userId: string, bookingId: string): Promise<DomesticWorkerBooking> {
    const { booking } = await this.findOwnedByWorkerOrThrow(userId, bookingId);
    if (booking.status !== DomesticWorkerBookingStatus.PENDING_CONFIRMATION) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز مش في حالة انتظار تأكيد', HttpStatus.CONFLICT);
    }

    return this.dataSource.transaction(async (manager) => {
      const lockedBooking = await manager
        .createQueryBuilder(DomesticWorkerBooking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :bookingId', { bookingId })
        .getOne();
      if (!lockedBooking || lockedBooking.status !== DomesticWorkerBookingStatus.PENDING_CONFIRMATION) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز مش في حالة انتظار تأكيد', HttpStatus.CONFLICT);
      }

      const now = new Date();
      lockedBooking.status = DomesticWorkerBookingStatus.AWAITING_PAYMENT;
      lockedBooking.acceptedAt = now;
      if (lockedBooking.bookingType === DomesticWorkerBookingType.MONTHLY_LIVE_IN) {
        lockedBooking.pendingPeriodEndAt = addMonths(
          lockedBooking.scheduledAt.getTime() > now.getTime() ? lockedBooking.scheduledAt : now,
          1,
        );
      }
      return manager.save(lockedBooking);
    });
  }

  private async commissionSplit(priceCents: number): Promise<{ platformCommissionCents: number; workerEarningCents: number }> {
    const commissionPercentage = await this.commissionPercentage();
    const platformCommissionCents = Math.round((priceCents * commissionPercentage) / 100);
    return { platformCommissionCents, workerEarningCents: priceCents - platformCommissionCents };
  }

  /**
   * InstaPay اتأكدت إداريًا لحجز خدمة منزلية (`PaymentsService.confirmInstaPayPayment`، حدث
   * `DOMESTIC_WORKER_BOOKING_PAYMENT_CONFIRMED_EVENT` — docs/adr/0019). بالساعة: مفيش حاجة تتعمل
   * هنا — الاستحقاق لسه بيتسجّل بس في `completeHourly()` بعد اكتمال الزيارة الفعلي، زي الأول
   * بالظبط. شهري بس: تسجيل استحقاق الشغالة PENDING عن الفترة اللي اتدفعت (نفس السلوك القديم، بس
   * الزناد بقى تأكيد الدفع مش لحظة الخصم). **Idempotent عمدًا** — لو الحدث اتبعت مرتين (retry بعد
   * انقطاع عابر) بيرجع بهدوء لو صف الاستحقاق بنفس `sourceKey` موجود بالفعل، بلا تسجيل مكرر.
   */
  @OnEvent(DOMESTIC_WORKER_BOOKING_PAYMENT_CONFIRMED_EVENT)
  async onBookingPaymentConfirmed(event: DomesticWorkerBookingPaymentConfirmedEvent): Promise<void> {
    try {
      await this.handleBookingPaymentConfirmed(event.bookingId);
    } catch (err) {
      // لا نوقف بقية المستمعين؛ نفس فلسفة PrepaidOrderSettlementListener — فشل عابر هنا محتاج
      // مراجعة يدوية مش يكسر تأكيد الدفع نفسه (اللي نجح بالفعل جوّه PaymentsService).
      this.logger.error(
        `فشل تسجيل استحقاق شهري بعد تأكيد دفع حجز ${event.bookingId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async handleBookingPaymentConfirmed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking || booking.bookingType !== DomesticWorkerBookingType.MONTHLY_LIVE_IN) return;
    if (booking.status !== DomesticWorkerBookingStatus.ACTIVE || !booking.currentPeriodEndAt) return;

    const worker = await this.profiles.findOne({ where: { id: booking.workerId } });
    if (!worker) return;

    const sourceKey = `monthly:${booking.currentPeriodEndAt.toISOString()}`;
    const existing = await this.earningApprovals.findOne({ where: { bookingId: booking.id, sourceKey } });
    if (existing) return;

    const { workerEarningCents } = await this.commissionSplit(booking.priceCents);
    if (workerEarningCents <= 0) return;

    await this.earningApprovals.save(
      this.earningApprovals.create({
        bookingId: booking.id,
        workerUserId: worker.userId,
        sourceKey,
        amountCents: workerEarningCents,
        status: DomesticWorkerEarningApprovalStatus.PENDING,
      }),
    );
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

  /**
   * إلغاء عميل — بيتعامل مع كل حالات الدفع الممكنة (docs/adr/0019، توجيه صريح: "handle
   * cancellation and refunds consistently"):
   * - `pending_confirmation`/`awaiting_payment` (مفيش دفع اتأكد لسه): إلغاء بسيط + إبطال أي دفعة
   *   InstaPay معلّقة مرتبطة (عشان الأدمن ميأكدش دفعة لحجز اتلغى).
   * - `confirmed`/`active` (دفع InstaPay اتأكد فعليًا): استرداد كامل حقيقي عبر
   *   `PaymentsService.refundCancelledDomesticWorkerBooking()` بعد الإلغاء — بره الـtransaction
   *   عمدًا (استرداد InstaPay بيرجع wallet credit فوري، لكن نفس نمط الأمان بتاع طلبات orders
   *   بالحرف لأي بوابة تانية مستقبلية). فشل الاسترداد بيتلقط ويتسجّل بس مايكسرش تجربة العميل —
   *   الحجز فضل ملغي صح حتى لو الاسترداد فشل واحتاج مراجعة يدوية.
   */
  async cancel(userId: string, bookingId: string, dto: CancelWorkerBookingDto): Promise<DomesticWorkerBooking> {
    const ownedBooking = await this.findOwnedByCustomerOrThrow(userId, bookingId);
    const { cancelledBooking, hadConfirmedPayment } = await this.dataSource.transaction(async (manager) => {
      const booking = await manager
        .createQueryBuilder(DomesticWorkerBooking, 'booking')
        .setLock('pessimistic_write')
        .where('booking.id = :bookingId', { bookingId: ownedBooking.id })
        .getOne();
      if (!booking || booking.status === DomesticWorkerBookingStatus.COMPLETED || booking.status === DomesticWorkerBookingStatus.CANCELLED) {
        throw new ApiException(ErrorCode.VAL_001, 'الحجز ده مش قابل للإلغاء دلوقتي', HttpStatus.CONFLICT);
      }
      const hadConfirmedPayment =
        booking.status === DomesticWorkerBookingStatus.CONFIRMED || booking.status === DomesticWorkerBookingStatus.ACTIVE;

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

      // أي دفعة InstaPay لسه معلّقة (لسه ما اتأكدتش/ما اترفضتش) بقت من غير محل بإلغاء الحجز.
      await manager
        .createQueryBuilder()
        .update(Payment)
        .set({ paymentStatus: PaymentGatewayStatus.CANCELLED })
        .where('domestic_worker_booking_id = :bookingId', { bookingId: booking.id })
        .andWhere('payment_status = :status', { status: PaymentGatewayStatus.PENDING })
        .execute();

      booking.status = DomesticWorkerBookingStatus.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancellationReason = dto.reason ?? null;
      booking.autoRenew = false;
      const cancelledBooking = await manager.save(booking);
      return { cancelledBooking, hadConfirmedPayment };
    });

    if (hadConfirmedPayment) {
      try {
        await this.paymentsService.refundCancelledDomesticWorkerBooking(
          cancelledBooking.id,
          `استرداد تلقائي — العميل لغى حجز خدمة منزلية مدفوع InstaPay${dto.reason ? `: ${dto.reason}` : ''}`,
        );
      } catch (err) {
        this.logger.error(
          `فشل استرداد حجز خدمة منزلية ${cancelledBooking.id} بعد الإلغاء — يحتاج مراجعة يدوية`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return cancelledBooking;
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
      // "renewed" هنا معناها "دخل انتظار دفع تجديد جديد" مش "اتجدد فعليًا" — التجديد الفعلي بيحصل
      // بس لما InstaPay تتأكد إداريًا (docs/adr/0019)، مش لحظة الـsweep.
      this.logger.log(`حجوزات الخدمات المنزلية: ${renewed} دخلوا انتظار دفع تجديد، ${expired} عقد انتهى`);
    }
    return { renewed, expired };
  }

  /**
   * فترة عقد شهري وصلت نهايتها — بدل التجديد الصامت القديم (خصم فوري من المحفظة)، الحجز بينتقل
   * لـ`awaiting_payment` (نفس بوابة الدفع اليدوي بتاعة InstaPay، docs/adr/0019) لحد ما دفعة جديدة
   * تتأكد إداريًا. **تغيير سلوك حقيقي ومقصود عن قبل**: التجديد بقى محتاج فعل بشري (العميل يدفع،
   * الأدمن يأكّد) بدل ما يحصل صامت — نفس السبب اللي خلى الدفع الأولي يتغيّر: مفيش top-up لمحفظة
   * العميل، فخصم صامت شهري كان بيفشل بصمت لنفس البَقّة بالظبط كل شهر.
   */
  private async tryRenew(bookingId: string, expectedPeriodEnd: Date, now: Date): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
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

      booking.status = DomesticWorkerBookingStatus.AWAITING_PAYMENT;
      booking.pendingPeriodEndAt = addMonths(booking.currentPeriodEndAt, 1);
      await manager.save(booking);
      return true;
    });
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
