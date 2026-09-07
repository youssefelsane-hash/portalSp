import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  RECURRING_ORDER_AWAITING_PAYMENT_EVENT,
  RecurringOrderAwaitingPaymentEvent,
} from '../../common/events/recurring-order-awaiting-payment.event';
import {
  RECURRING_TEMPLATE_GENERATION_FAILING_EVENT,
  RecurringTemplateGenerationFailingEvent,
} from '../../common/events/recurring-template-generation-failing.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { buildPricingContext } from '../pricing/pricing-context';
import { contractPeriodFromFieldValues } from '../pricing/pricing-templates';
import { TechniciansService } from '../technicians/technicians.service';
import { BuildingsService } from '../buildings/buildings.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRecurringTemplateDto } from './dto/create-recurring-template.dto';
import { UpdateRecurringTemplateDto } from './dto/update-recurring-template.dto';
import { BookingMode, OrderType } from './entities/order.entity';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { nextOccurrence } from './recurring-schedule.util';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentGatewayStatus, PaymentMethod } from '../payments/entities/payment.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import {
  RECURRING_CARD_PAYMENT_FAILED_EVENT,
  RECURRING_CASH_REMINDER_EVENT,
  RecurringCardPaymentFailedEvent,
  RecurringCashReminderEvent,
} from '../../common/events/recurring-order-payment.event';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 25;
const CLAIM_LEASE_MS = 5 * 60_000;
const MATERIALIZATION_LEAD_TIME_HOURS_FALLBACK = 96;
const RECURRING_CARD_COLLECTION_LEAD_DAYS = 3;
const RECURRING_CASH_REMINDER_LEAD_DAYS = 4;
const RECURRING_CARD_PAYMENT_DEADLINE_HOURS = 24;
const RECURRING_CARD_MAX_ATTEMPTS = 3;
// T-3 ثم T-2 ثم T-1: ثلاث فرص موزعة على يومين، وتنتهي قبل الموعد بـ24 ساعة.
const RECURRING_CARD_RETRY_HOURS = 24;

// docs/08 §19 بند 20 — عدد محاولات إعادة توليد نفس الموعد (كل محاولة = دورة sweep، فحوالي 3
// دقايق إجمالاً) قبل ما نستسلم ونعتبره "dead letter" — كافي لفشل مؤقت (DB/شبكة) يتعافى لوحده،
// مش كتير لدرجة إن موعد فايت يفضل يتحاول للأبد وهو مستحيل ينجح (مثلاً عنوان اتمسح).
const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_BACKOFF_MS = [30_000, 2 * 60_000, 5 * 60_000] as const;

type ClaimedOccurrence = {
  id: string;
  templateId: string;
  scheduledFor: Date;
  attemptCount: number;
  recoveredStaleClaim: boolean;
};

type ClaimedOccurrenceRow = {
  id: string;
  template_id: string;
  scheduled_for: Date;
  attempt_count: number;
  previous_status: string;
};

type ClaimedRecurringCardPayment = {
  id: string;
  order_number: string;
  customer_id: string;
  scheduled_at: Date;
  total_amount_cents: number;
  attempt_number: number;
};

// صف قائمة خطط الحجز المتكرر للأدمن — نتيجة الـJOIN المُثري في listAllForAdmin() (snake_case
// زي أي نتيجة query خام، وبتتحول لـDTO عبر toAdminRecurringPlanResponseDto).
export type AdminRecurringPlanRow = {
  id: string;
  customer_id: string;
  customer_full_name: string;
  customer_phone: string;
  service_id: string;
  service_name_ar: string;
  address_id: string;
  address_label: string | null;
  booking_mode: string;
  building_id: string | null;
  building_code: string | null;
  building_name_ar: string | null;
  frequency: string;
  payment_method: 'card' | 'instapay' | null;
  next_run_at: Date;
  last_generated_order_id: string | null;
  last_order_number: string | null;
  last_occurrence_at: Date | null;
  is_active: boolean;
  created_at: Date;
  cancelled_at: Date | null;
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: Date | null;
};

/**
 * الجدولة المستقبلية/المتكررة (docs/08 §11) — order_type='recurring' كان قيمة enum من الأول
 * (migration 0002) بس بلا آلية توليد حقيقية. القالب هنا بيولّد طلب حقيقي عبر `OrdersService.create()`
 * نفسها (صفر تكرار منطق تسعير/تحقق) في كل موعد مستحق.
 *
 * **قرار تصميم متعمّد**: فحص دوري (`setInterval`) مش BullMQ repeatable job — نفس فلسفة
 * `OrderAutoCancelService` بالحرف (راجع تعليقها الكامل هناك). لو استخدمنا BullMQ هنا، "الالتزام
 * المتكرر" كان هيعتمد على نفس الـ Worker اللي عنده بَقّة recovery موثّقة بعد انقطاع Redis طويل.
 *
 * **تفضيل الفني مش ضمان**: `requested_technician_id` بيتمرّر لـ`OrdersService.create()` زي أي
 * "إعادة حجز" عادي — لو الفني مش متاح وقت التوليد، الطلب المولّد بيرجع للتوزيع العادي تلقائيًا
 * (نفس السلوك الموثّق في `matching/README.md`)، مش بيتلغي أو يستنى. مفيش قفل/حجز سلوت مسبق هنا —
 * خارج نطاق v1، القالب بيولّد الطلب بس زي لو العميل بنفسه حجزه في اللحظة دي بالظبط.
 */
@Injectable()
export class RecurringOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringOrdersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(RecurringOrderTemplate) private readonly templates: Repository<RecurringOrderTemplate>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly techniciansService: TechniciansService,
    private readonly ordersService: OrdersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly buildingsService: BuildingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
    // آخر dependency عمدًا: اختبارات قديمة تبني الخدمة positional وتغطي create/list فقط.
    // Nest يحقنها في التطبيق الفعلي، وغيابها في اختبار قديم لا يفعّل sweep التحصيل أصلًا.
    private readonly paymentsService?: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'recurring-orders', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(userId: string, dto: CreateRecurringTemplateDto): Promise<RecurringOrderTemplate> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);
    if (dto.requested_technician_id) {
      await this.techniciansService.findByProfileIdOrThrow(dto.requested_technician_id);
    }

    // انتماء العمارة (migration 0257، docs/08 §125) — نفس تحقق OrdersService.create() بالحرف:
    // 404 واضح لو الكود غلط وقت الإنشاء، مش فشل صامت كل موعد بعدين.
    const building = dto.building_code
      ? await this.buildingsService.findActiveByCodeOrThrow(dto.building_code)
      : null;

    // قدرة "الحجز المتكرر" لكل خدمة (migration 0176) — نفس نمط بوابة allows_individual/
    // cash_allowed بالحرف: الخدمة مش مفعّل فيها التكرار يعني مفيش قالب متكرر خالص، بدل ما
    // ينشئ قالب يفشل عند التوليد بصمت كل موعد.
    if (!service.allowsRecurringBooking) {
      throw new ApiException(ErrorCode.VAL_001, 'الحجز المتكرر مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }

    if (dto.requested_technician_company_id) {
      const bookingModeForCompany = dto.booking_mode ?? BookingMode.INDIVIDUAL;
      if (bookingModeForCompany !== BookingMode.TEAM) {
        throw new ApiException(ErrorCode.VAL_001, 'اختيار شركة/فريق محدد متاح بس لوضع "اعتماد"', HttpStatus.BAD_REQUEST);
      }
      // فحص وجود/نشاط الشركة مباشرة بالـSQL — نفس فحص TechnicianCompaniesService.findActiveCompanyOrThrow
      // بدون حقن تبعية إضافية (الموديولات هنا في موديول واحد، والفحص استعلام واحد بسيط).
      const [company] = await this.templates.manager.query<{ exists: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM technician_companies WHERE id = $1 AND is_active = true AND deleted_at IS NULL) AS exists`,
        [dto.requested_technician_company_id],
      );
      if (!company?.exists) {
        throw new ApiException(ErrorCode.VAL_001, 'الشركة غير موجودة أو غير نشطة', HttpStatus.NOT_FOUND);
      }
    }

    // نفس فحص OrdersService.create() بالحرف — كانت فجوة حقيقية اتلقطت وقت بناء واجهة العميل:
    // مفيش تحقق هنا خالص، يعني العميل كان يقدر ينشئ قالب متكرر بـbooking_mode مش متاح للخدمة
    // (مثلاً "فرد" لخدمة بتدعم "فريق" بس) وياخد رد 200 ناجح — بعدين generateFromTemplate() كانت
    // هتفشل بصمت كل موعد (راجع تعليق generateFromTemplate()/recordFailure() تحت لتصميم إعادة
    // المحاولة/dead-letter الحالي — docs/08 §19 بند 20) من غير ما العميل ياخد أي تنبيه.
    const bookingMode = dto.booking_mode ?? BookingMode.INDIVIDUAL;
    const bookingModeAllowed =
      bookingMode === BookingMode.INDIVIDUAL
        ? service.allowsIndividual
        : bookingMode === BookingMode.TEAM
          ? service.allowsTeam
          : service.allowsEmergency;
    if (!bookingModeAllowed) {
      throw new ApiException(ErrorCode.VAL_001, 'وضع الحجز ده مش متاح لهذه الخدمة', HttpStatus.BAD_REQUEST);
    }

    // ADR-0060 §3/§4 — الكمية والمدة والفترة اتشالوا من الـDTO خالص (مش مرفوضين بحارس): الـ
    // ValidationPipe العام (`forbidNonWhitelisted`) بيرفض أي واحد فيهم قبل ما يوصل هنا أصلاً.
    // القالب بيتسعّر من `field_values` زي الطلب العادي بالحرف.

    const startsAt = new Date(dto.starts_at);
    if (startsAt.getTime() <= Date.now()) {
      throw new ApiException(ErrorCode.VAL_001, 'أول موعد تنفيذ لازم يكون في المستقبل', HttpStatus.BAD_REQUEST);
    }

    const period = contractPeriodFromFieldValues(dto.field_values);
    const pricingContext = buildPricingContext({
      scheduledAt: startsAt,
      periodStart: period.start,
      periodEnd: period.end,
      serviceFieldValues: dto.field_values,
      bookingMode: dto.booking_mode,
      recurringMetadata: { frequency: dto.frequency },
    });

    const template = this.templates.create({
      customerId: customerProfile.id,
      serviceId: dto.service_id,
      addressId: dto.address_id,
      bookingMode: dto.booking_mode,
      requestedTechnicianId: dto.requested_technician_id ?? null,
      requestedTechnicianCompanyId: dto.requested_technician_company_id ?? null,
      buildingId: building ? building.id : null,
      frequency: dto.frequency,
      fieldValues: dto.field_values ?? null,
      pricingQuantity: null,
      durationHours: null,
      durationMinutes: pricingContext.durationMinutes,
      scheduledEndAt: null,
      problemDescription: dto.problem_description ?? null,
      paymentMethod: dto.payment_method ?? null,
      nextRunAt: startsAt,
      isActive: true,
    });
    return this.templates.save(template);
  }

  async listForCustomer(userId: string): Promise<RecurringOrderTemplate[]> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    return this.templates.find({ where: { customerId: customerProfile.id }, order: { createdAt: 'DESC' } });
  }

  // للأدمن/التشغيل بس — "خطط الحجز المتكرر" (تعريف التكرار نفسه، مش الطلبات المتولّدة منه —
  // الطلبات بتتشاف من /admin/orders بفلتر التكرار). صفوف مُثراة بأسماء/أرقام حقيقية بدل UUIDs خام
  // (كانت فجوة عرض: العمليات كانت مضطرة تنسخ UUID العميل وتدوّر عليه يدويًا).
  async listAllForAdmin(
    isActive: boolean | undefined,
    page: number,
    perPage: number,
  ): Promise<{ items: AdminRecurringPlanRow[]; meta: { page: number; per_page: number; total: number } }> {
    const offset = (page - 1) * perPage;
    const [rows, countRows] = await Promise.all([
      this.templates.manager.query<AdminRecurringPlanRow[]>(
        `SELECT t.id,
                t.customer_id,
                u.full_name AS customer_full_name,
                u.phone_number AS customer_phone,
                t.service_id,
                s.name_ar AS service_name_ar,
                t.address_id,
                COALESCE(a.label, a.street_name) AS address_label,
                t.booking_mode,
                t.building_id,
                b.code AS building_code,
                b.name_ar AS building_name_ar,
                t.frequency,
                t.payment_method,
                t.next_run_at,
                t.last_generated_order_id,
                o.order_number AS last_order_number,
                o.scheduled_at AS last_occurrence_at,
                t.is_active,
                t.created_at,
                t.deleted_at AS cancelled_at,
                t.consecutive_failure_count,
                t.last_failure_reason,
                t.last_failed_at
         FROM recurring_order_templates t
         JOIN customer_profiles cp ON cp.id = t.customer_id
         JOIN users u ON u.id = cp.user_id
         JOIN services s ON s.id = t.service_id
         JOIN addresses a ON a.id = t.address_id
         LEFT JOIN orders o ON o.id = t.last_generated_order_id
         LEFT JOIN buildings b ON b.id = t.building_id
         WHERE t.deleted_at IS NULL AND ($1::boolean IS NULL OR t.is_active = $1)
         ORDER BY t.next_run_at ASC, t.id ASC
         LIMIT $2 OFFSET $3`,
        [isActive ?? null, perPage, offset],
      ),
      this.templates.manager.query<{ total: string }[]>(
        `SELECT COUNT(*)::text AS total
         FROM recurring_order_templates t
         WHERE t.deleted_at IS NULL AND ($1::boolean IS NULL OR t.is_active = $1)`,
        [isActive ?? null],
      ),
    ]);
    return { items: rows, meta: { page, per_page: perPage, total: Number(countRows[0]?.total ?? 0) } };
  }

  private async findOwnedOrThrow(userId: string, templateId: string): Promise<RecurringOrderTemplate> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const template = await this.templates.findOne({ where: { id: templateId, customerId: customerProfile.id } });
    if (!template) {
      throw new ApiException(ErrorCode.VAL_001, 'القالب المتكرر غير موجود', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  async update(userId: string, templateId: string, dto: UpdateRecurringTemplateDto): Promise<RecurringOrderTemplate> {
    const template = await this.findOwnedOrThrow(userId, templateId);
    template.isActive = dto.is_active;
    return this.templates.save(template);
  }

  async remove(userId: string, templateId: string): Promise<void> {
    const template = await this.findOwnedOrThrow(userId, templateId);
    await this.templates.softDelete(template.id);
  }

  // templateIds اختياري — بيقصر الدورة دي على قوالب بعينها بدل كل الجدول. الإنتاج بيناديها
  // من غير حاجة (فلترة كاملة)، وبتستخدم في الاختبارات الحية عشان worker موازي مايعالجش قوالب
  // ملف اختبار تاني شغال على نفس القاعدة (بَقّة عزل اختبار موثّقة في الـspecs المجاورة).
  async sweep(options?: { templateIds?: string[] }): Promise<number> {
    // أنشئ النوبة قبل أي تذكير/تحصيل. كده الموعد الذي يدخل نافذة T-4 أو T-3 الآن يُعالج
    // في الدورة نفسها، ولا ينتظر دقيقة إضافية بلا سبب.
    await this.materializeDueOccurrences(SWEEP_BATCH_SIZE, options?.templateIds);
    await this.sweepRecurringPaymentCollection(options?.templateIds);
    await this.sendRecurringCashReminders(options?.templateIds);
    const occurrences = await this.claimOccurrences(SWEEP_BATCH_SIZE, options?.templateIds);

    let generatedCount = 0;
    for (const occurrence of occurrences) {
      if (await this.processOccurrence(occurrence)) generatedCount++;
    }
    if (generatedCount > 0) {
      this.logger.log(`الطلبات المتكررة: ${generatedCount} طلب اتولّد تلقائيًا`);
    }
    return generatedCount;
  }

  /**
   * نوبات البطاقة تُولّد قبل الموعد بأربعة أيام، لكن السحب يبدأ عند T-3 أيام. claim ذري يحجز
   * المحاولة ويزيد عدادها قبل أي اتصال بوابة، لذلك لا يمكن لنسختين API تحصيل النوبة نفسها.
   */
  private async sweepRecurringPaymentCollection(templateIds?: string[]): Promise<void> {
    if (!this.paymentsService || typeof this.dataSource.query !== 'function') return;
    const claimedRaw = await this.dataSource.query<ClaimedRecurringCardPayment[] | [ClaimedRecurringCardPayment[], number]>(
      `WITH candidates AS (
         SELECT o.id
         FROM orders o
         WHERE o.order_type = 'recurring'
           AND o.order_status = 'pending_payment'
           AND o.payment_method = 'card'
           AND o.scheduled_at >= now() + ($4::integer * interval '1 hour')
           AND o.scheduled_at <= now() + ($3::integer * interval '1 day')
           AND o.recurring_payment_attempt_count < $2
           AND COALESCE(o.recurring_payment_next_attempt_at, o.scheduled_at - ($3::integer * interval '1 day')) <= now()
           AND ($5::uuid[] IS NULL OR o.recurring_template_id = ANY($5))
         ORDER BY o.scheduled_at, o.id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE orders o
       SET recurring_payment_attempt_count = o.recurring_payment_attempt_count + 1,
           -- lease قصيرة فقط؛ النتيجة تضبط الموعد الحقيقي بعد استدعاء البوابة.
           recurring_payment_next_attempt_at = now() + interval '15 minutes'
       FROM candidates
       WHERE o.id = candidates.id
       RETURNING o.id, o.order_number, o.customer_id, o.scheduled_at, o.total_amount_cents,
                 o.recurring_payment_attempt_count AS attempt_number`,
      [SWEEP_BATCH_SIZE, RECURRING_CARD_MAX_ATTEMPTS, RECURRING_CARD_COLLECTION_LEAD_DAYS, RECURRING_CARD_PAYMENT_DEADLINE_HOURS, templateIds ?? null],
    );
    // TypeORM قد يعيد UPDATE ... RETURNING كـ[rows, affectedCount] بحسب الـdriver؛ نفس فك
    // الغلاف الموجود في claimOccurrences يمنع أن يصبح الصف الأول مصفوفة داخل الحلقة.
    const claimed = Array.isArray(claimedRaw[0])
      ? (claimedRaw[0] as ClaimedRecurringCardPayment[])
      : (claimedRaw as ClaimedRecurringCardPayment[]);

    for (const order of claimed) {
      const result = await this.paymentsService.attemptRecurringOrderCardCharge(order.id, Number(order.attempt_number));
      if (result.status === PaymentGatewayStatus.FAILED) {
        await this.handleRecurringCardFailure(order, result.failureReason ?? 'تم رفض عملية السحب من البطاقة');
      } else if (result.status === PaymentGatewayStatus.PENDING || result.status === PaymentGatewayStatus.PROCESSING) {
        // لا نعيد السحب بينما البوابة تؤكد العملية. عند T-24 تتوقف المحاولة التلقائية ويحتاج
        // pending غير محسوم إلى reconciliation، فلا نلغي مالًا قد يكون تحصّل فعليًا.
        await this.dataSource.query(
          `UPDATE orders SET recurring_payment_next_attempt_at = scheduled_at - ($2::integer * interval '1 hour')
           WHERE id = $1 AND order_status = 'pending_payment'`,
          [order.id, RECURRING_CARD_PAYMENT_DEADLINE_HOURS],
        );
      }
    }
  }

  private async handleRecurringCardFailure(order: ClaimedRecurringCardPayment, failureReason: string): Promise<void> {
    const attemptNumber = Number(order.attempt_number);
    const exhausted = attemptNumber >= RECURRING_CARD_MAX_ATTEMPTS;
    if (exhausted) {
      const cancelled = await this.cancelRecurringPaymentFailure(order.id, failureReason);
      if (cancelled) {
        this.eventEmitter.emit(
          ORDER_STATUS_CHANGED_EVENT,
          new OrderStatusChangedEvent(
            cancelled.id,
            cancelled.orderNumber,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.CANCELLED_BY_SYSTEM,
            cancelled.customerId,
            cancelled.technicianId,
            'إلغاء تلقائي بعد فشل تحصيل البطاقة المتكررة',
          ),
        );
        this.eventEmitter.emit(
          RECURRING_CARD_PAYMENT_FAILED_EVENT,
          new RecurringCardPaymentFailedEvent(order.id, order.order_number, order.customer_id, attemptNumber, true, failureReason),
        );
      }
      return;
    }

    await this.dataSource.query(
      `UPDATE orders
       SET recurring_payment_next_attempt_at = LEAST(
             scheduled_at - ($3::integer * interval '1 hour'),
             now() + ($2::integer * interval '1 hour')
           )
       WHERE id = $1 AND order_status = 'pending_payment'`,
      [order.id, RECURRING_CARD_RETRY_HOURS, RECURRING_CARD_PAYMENT_DEADLINE_HOURS],
    );
    this.eventEmitter.emit(
      RECURRING_CARD_PAYMENT_FAILED_EVENT,
      new RecurringCardPaymentFailedEvent(order.id, order.order_number, order.customer_id, attemptNumber, false, failureReason),
    );
  }

  private async cancelRecurringPaymentFailure(orderId: string, failureReason: string): Promise<Order | null> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order || order.orderStatus !== OrderStatus.PENDING_PAYMENT || order.recurringTemplateId === null) return null;

      const previousStatus = order.orderStatus;
      order.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
      order.cancelledAt = new Date();
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
          changedByRole: 'system',
          changeSource: OrderChangeSource.SYSTEM,
          reason: `إلغاء النوبة المتكررة بعد ${RECURRING_CARD_MAX_ATTEMPTS} محاولات تحصيل فاشلة: ${failureReason}`,
        }),
      );
      return order;
    });
  }

  private async sendRecurringCashReminders(templateIds?: string[]): Promise<void> {
    // بعض اختبارات التوليد القديمة تستخدم DataSource شكليًا لأنها لم تكن تحتاجه؛ لا نُشغّل
    // الـscheduler الجديد في هذه الوحدة الناقصة، بينما التطبيق الفعلي يملك DataSource حقيقيًا.
    if (typeof this.dataSource.query !== 'function') return;
    const remindedRaw = await this.dataSource.query<
      | { id: string; order_number: string; customer_id: string; scheduled_at: Date; total_amount_cents: number }[]
      | [{ id: string; order_number: string; customer_id: string; scheduled_at: Date; total_amount_cents: number }[], number]
    >(
      `WITH candidates AS (
         SELECT o.id
         FROM orders o
         WHERE o.order_type = 'recurring'
           AND o.order_status NOT IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system', 'expired')
           AND (o.payment_method IS NULL OR o.payment_method = 'cash')
           AND o.recurring_cash_reminder_sent_at IS NULL
           AND o.scheduled_at > now()
           AND o.scheduled_at <= now() + ($1::integer * interval '1 day')
           AND ($2::uuid[] IS NULL OR o.recurring_template_id = ANY($2))
         ORDER BY o.scheduled_at, o.id
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE orders o
       SET recurring_cash_reminder_sent_at = now()
       FROM candidates
       WHERE o.id = candidates.id
       RETURNING o.id, o.order_number, o.customer_id, o.scheduled_at, o.total_amount_cents`,
      [RECURRING_CASH_REMINDER_LEAD_DAYS, templateIds ?? null, SWEEP_BATCH_SIZE],
    );
    const reminded = Array.isArray(remindedRaw[0])
      ? (remindedRaw[0] as { id: string; order_number: string; customer_id: string; scheduled_at: Date; total_amount_cents: number }[])
      : (remindedRaw as { id: string; order_number: string; customer_id: string; scheduled_at: Date; total_amount_cents: number }[]);
    for (const order of reminded) {
      this.eventEmitter.emit(
        RECURRING_CASH_REMINDER_EVENT,
        new RecurringCashReminderEvent(order.id, order.order_number, order.customer_id, order.scheduled_at, Number(order.total_amount_cents)),
      );
    }
  }

  private async materializeDueOccurrences(limit: number, templateIds?: string[]): Promise<void> {
    const [{ lead_hours: rawLeadHours } = { lead_hours: MATERIALIZATION_LEAD_TIME_HOURS_FALLBACK }] =
      await this.templates.manager.query<{ lead_hours: number }[]>(
        `SELECT COALESCE(
           (SELECT CASE
              WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric
              WHEN jsonb_typeof(value) = 'string'
                AND (value #>> '{}') ~ '^[0-9]+([.][0-9]+)?$'
                THEN (value #>> '{}')::numeric
              ELSE NULL
            END
            FROM settings
            WHERE key = 'recurring.materialization_lead_time_hours'),
           $1::numeric
         )::float AS lead_hours`,
        [MATERIALIZATION_LEAD_TIME_HOURS_FALLBACK],
      );
    const parsedLeadHours = Number(rawLeadHours);
    const leadHours = Number.isFinite(parsedLeadHours)
      ? Math.max(0, Math.min(24 * 365, parsedLeadHours))
      : MATERIALIZATION_LEAD_TIME_HOURS_FALLBACK;
    await this.templates.manager.query(
      `WITH due AS (
         SELECT id, next_run_at
         FROM recurring_order_templates
         WHERE is_active = true AND deleted_at IS NULL
           AND next_run_at <= now() + ($3::double precision * interval '1 hour')
           AND ($2::uuid[] IS NULL OR id = ANY($2))
         ORDER BY next_run_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       INSERT INTO recurring_order_occurrences (template_id, scheduled_for)
       SELECT id, next_run_at FROM due
       ON CONFLICT (template_id, scheduled_for) DO NOTHING`,
      [limit, templateIds ?? null, leadHours],
    );
  }

  private async claimOccurrences(limit: number, templateIds?: string[]): Promise<ClaimedOccurrence[]> {
    const result = await this.templates.manager.query<ClaimedOccurrenceRow[] | [ClaimedOccurrenceRow[], number]>(
      `WITH candidates AS (
         SELECT id, status AS previous_status
         FROM recurring_order_occurrences
         WHERE (
           status IN ('pending', 'failed')
           AND next_attempt_at <= now()
           AND attempt_count < $2
         ) OR (
           status = 'processing'
           AND claimed_at <= now() - ($3::integer * interval '1 millisecond')
         )
         AND ($4::uuid[] IS NULL OR template_id = ANY($4))
         ORDER BY scheduled_for, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE recurring_order_occurrences occurrence
       SET status = 'processing',
           attempt_count = CASE
             WHEN candidates.previous_status = 'processing' THEN occurrence.attempt_count
             ELSE occurrence.attempt_count + 1
           END,
           claimed_at = now(),
           updated_at = now()
       FROM candidates
       WHERE occurrence.id = candidates.id
       RETURNING occurrence.id,
                 occurrence.template_id,
                 occurrence.scheduled_for,
                 occurrence.attempt_count,
                 candidates.previous_status`,
      [limit, MAX_CONSECUTIVE_FAILURES, CLAIM_LEASE_MS, templateIds ?? null],
    );
    // TypeORM's PostgreSQL runner returns UPDATE ... RETURNING as
    // [rows, affectedCount], unlike SELECT/INSERT which return rows directly.
    const rows = Array.isArray(result[0]) ? result[0] : (result as ClaimedOccurrenceRow[]);

    return rows.map((row) => {
      const scheduledFor = new Date(row.scheduled_for);
      if (Number.isNaN(scheduledFor.getTime())) {
        throw new Error(`Invalid recurring occurrence claim row: ${JSON.stringify(row)}`);
      }
      return {
        id: row.id,
        templateId: row.template_id,
        scheduledFor,
        attemptCount: Number(row.attempt_count),
        recoveredStaleClaim: row.previous_status === 'processing',
      };
    });
  }

  private async findGeneratedOrder(occurrence: ClaimedOccurrence): Promise<{ id: string } | null> {
    const [order] = await this.templates.manager.query<Array<{ id: string }>>(
      `SELECT id
       FROM orders
       WHERE recurring_template_id = $1 AND recurring_occurrence_at = $2
       LIMIT 1`,
      [occurrence.templateId, occurrence.scheduledFor],
    );
    return order ?? null;
  }

  private async processOccurrence(occurrence: ClaimedOccurrence): Promise<boolean> {
    const existingOrder = await this.findGeneratedOrder(occurrence);
    if (existingOrder) {
      await this.completeOccurrence(occurrence, existingOrder.id);
      return true;
    }

    const template = await this.templates.findOne({ where: { id: occurrence.templateId } });
    if (!template || !template.isActive) {
      await this.templates.manager.query(
        `UPDATE recurring_order_occurrences
         SET status = 'cancelled', claimed_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [occurrence.id],
      );
      return false;
    }

    // A crashed final attempt is never executed again. It can still be completed
    // above if the order commit happened before the worker died.
    if (occurrence.recoveredStaleClaim && occurrence.attemptCount >= MAX_CONSECUTIVE_FAILURES) {
      await this.recordFailure(occurrence, template, new Error('انتهت مهلة آخر محاولة توليد قبل تسجيل النتيجة'));
      return false;
    }

    let customerProfile;
    try {
      customerProfile = await this.customerProfiles.findByProfileIdOrThrow(template.customerId);
      // عميل متبلوك/محذوف — مفيش طلبات جديدة تتولّد له (نفس فلسفة فحص الحالة اللحظي في
      // JwtStrategy على كل request، بس هنا للتوليد الداخلي اللي بيتجاوز الـHTTP layer خالص).
      // الفشل بيمشي في نفس مسار recordFailure العادي (retry ثم dead-letter مرئي) بدل ما يفضل
      // القالب بيولّد طلبات لعميل ممنوع من المنصة بصمت.
      const [status] = await this.templates.manager.query<{ is_blocked: boolean; deleted_at: Date | null }[]>(
        `SELECT u.is_blocked, u.deleted_at
         FROM users u
         JOIN customer_profiles cp ON cp.user_id = u.id
         WHERE cp.id = $1`,
        [template.customerId],
      );
      if (status?.is_blocked || status?.deleted_at) {
        throw new Error('العميل متبلوك/محذوف — التوليد موقوف لحد ما الحالة تتغير');
      }
    } catch (err) {
      await this.recordFailure(occurrence, template, err);
      return false;
    }

    // انتماء العمارة (migration 0257، docs/08 §125) — بيتقرا **فريش** من الداتابيز في كل نوبة،
    // مش snapshot لنسبة الخصم القديمة: لو الإدارة غيّرت النسبة، النوبة الجديدة بتاخدها تلقائيًا
    // لأن OrdersService.create() هي اللي بتحسب الخصم من صف العمارة الحالي (نفس مسار الطلب العادي).
    //
    // لو العمارة اتقفلت (is_active=false) أو اتحذفت (soft-delete)، findActiveByIdOrNull بترجع
    // null بهدوء — الطلب بيتولّد **بالسعر الكامل من غير خصم** بدل ما يفشل أو يحسب خصم غلط
    // (طلب مالك صريح: "تعامل مع الحالة بأمان ومن غير ما تولّد سعر أو خصم خاطئ").
    const building = template.buildingId
      ? await this.buildingsService.findActiveByIdOrNull(template.buildingId)
      : null;
    if (template.buildingId && !building) {
      this.logger.warn(
        `القالب ${template.id} مرتبط بعمارة (${template.buildingId}) بقت غير صالحة — النوبة دي هتتولّد من غير خصم عمارة`,
      );
    }

    const createOrderDto: CreateOrderDto = {
      service_id: template.serviceId,
      address_id: template.addressId,
      booking_mode: template.bookingMode,
      order_type: OrderType.RECURRING,
      requested_technician_id: template.requestedTechnicianId ?? undefined,
      requested_technician_company_id: template.requestedTechnicianCompanyId ?? undefined,
      building_code: building ? building.code : undefined,
      problem_description: template.problemDescription ?? undefined,
      // occurrence.scheduledFor هو الموعد التجاري الحقيقي، مش metadata فقط. بدونه كان الطلب
      // المتكرر يتحول إلى ASAP ويأخذ رسوم/مطابقة نفس اليوم بالخطأ.
      scheduled_at: occurrence.scheduledFor.toISOString(),
      // مدخلات التسعير/التوقيت المحفوظة مع القالب (migration 0176) — **مدخلات مش سعر**: القيمة
      // الفعلية بيتحسبها محرك التسعير الحي جوّه OrdersService.create() وقت التوليد بالظبط، فتغيير
      // أسعار/قواعد الخدمة بيأثر على الطلبات الجديدة بس، والطلبات المتولّدة فعلاً بتحتفظ بـsnapshot
      // سعرها العادي زي أي طلب.
      // ADR-0060 — `field_values` هي **كل** مدخلات التسعير. الأعمدة القديمة على القالب
      // (`pricing_quantity`/`duration_hours`/`scheduled_end_at`) بقت بيانات تاريخية بس، وبعتها
      // هنا كان هيرفض كل نوبة متولّدة من قالب قديم: `OrdersService.create()` بيرفض التلاتة
      // صراحةً دلوقتي. بَقّة حقيقية كانت هتظهر أول ما قالب قديم ييجي معاده.
      field_values: template.fieldValues ?? undefined,
      // دفع قبل التوزيع (docs/08 §19 بند 6) — كانت فجوة حقيقية: صفر payment_method هنا خالص،
      // فكل طلب متولّد من قالب متكرر كان non-prepaid دايمًا مهما كان تفضيل العميل وقت إنشاء
      // القالب. لو الطلب المتولّد بقى PENDING_PAYMENT، sweepPendingPayment() (docs/08 §19 بند
      // 3+5 فوق) بيلغيه تلقائيًا لو العميل ماكملش الدفع خلال orders.payment_timeout_minutes —
      // نفس الحماية بالظبط اللي بتتطبّق على أي طلب PENDING_PAYMENT عادي.
      payment_method: template.paymentMethod ?? undefined,
    };

    try {
      const order = await this.ordersService.create(customerProfile.userId, createOrderDto, {
        templateId: occurrence.templateId,
        scheduledFor: occurrence.scheduledFor,
      });
      await this.completeOccurrence(occurrence, order.id);
      // طلب متولّد محتاج دفع مقدّم (كارت/InstaPay) — ORDER_CREATED_EVENT مش بيتصدّر لطلبات
      // PENDING_PAYMENT (تصميم pay-before-dispatch في OrdersService.create()) يعني مفيش إشعار
      // "طلبك اتسجّل" هيوصل. من غير الإشعار هنا، عميل اشترك في تكرار شهري كان هيلاقي طلبه اتلغى
      // تلقائيًا بعد مهلة الدفع من غير ما يعرف أصلاً إن فيه طلب استنى دفعه. نفس نمط
      // OrderCreatedNotificationListener (إشعار مباشر للعميل، fire-and-forget آمن).
      // البطاقة المحفوظة لا تطلب من العميل دفعًا يدويًا هنا: التحصيل التلقائي يبدأ عند T-3.
      // InstaPay يظل مساره اليدوي كما هو ويأخذ إشعار "أكمل الدفع" الحالي.
      if (order.orderStatus === 'pending_payment' && template.paymentMethod !== PaymentMethod.CARD) {
        this.eventEmitter.emit(
          RECURRING_ORDER_AWAITING_PAYMENT_EVENT,
          new RecurringOrderAwaitingPaymentEvent(order.id, order.orderNumber, order.customerId),
        );
      }
      return true;
    } catch (err) {
      // OrdersService emits critical dispatch only after its DB transaction. If
      // that post-commit step fails, the unique occurrence identity lets this
      // worker acknowledge the already durable order instead of creating another.
      const committedOrder = await this.findGeneratedOrder(occurrence);
      if (committedOrder) {
        await this.completeOccurrence(occurrence, committedOrder.id);
        return true;
      }
      await this.recordFailure(occurrence, template, err);
      return false;
    }
  }

  private async completeOccurrence(occurrence: ClaimedOccurrence, orderId: string): Promise<void> {
    await this.templates.manager.transaction(async (manager) => {
      const template = await manager
        .createQueryBuilder(RecurringOrderTemplate, 'template')
        .setLock('pessimistic_write')
        .where('template.id = :templateId', { templateId: occurrence.templateId })
        .getOne();
      if (!template) return;

      await manager.query(
        `UPDATE recurring_order_occurrences
         SET status = 'completed', order_id = $2, completed_at = now(),
             claimed_at = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [occurrence.id, orderId],
      );

      if (template.nextRunAt.getTime() === occurrence.scheduledFor.getTime()) {
        template.nextRunAt = nextOccurrence(occurrence.scheduledFor, template.frequency);
        template.lastGeneratedOrderId = orderId;
        template.consecutiveFailureCount = 0;
        template.lastFailureReason = null;
        template.lastFailedAt = null;
        await manager.save(template);
      }
    });
  }

  private async recordFailure(
    occurrence: ClaimedOccurrence,
    template: RecurringOrderTemplate,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `فشل توليد طلب من القالب المتكرر ${template.id} (محاولة ${occurrence.attemptCount})`,
      err instanceof Error ? err.stack : reason,
    );

    const exhausted = occurrence.attemptCount >= MAX_CONSECUTIVE_FAILURES;
    await this.templates.manager.transaction(async (manager) => {
      const lockedTemplate = await manager
        .createQueryBuilder(RecurringOrderTemplate, 'template')
        .setLock('pessimistic_write')
        .where('template.id = :templateId', { templateId: occurrence.templateId })
        .getOne();
      if (!lockedTemplate) return;

      if (exhausted) {
        await manager.query(
          `UPDATE recurring_order_occurrences
           SET status = 'manual_review', claimed_at = NULL, last_error = $2, updated_at = now()
           WHERE id = $1 AND status = 'processing'`,
          [occurrence.id, reason],
        );
        if (lockedTemplate.nextRunAt.getTime() === occurrence.scheduledFor.getTime()) {
          lockedTemplate.nextRunAt = nextOccurrence(occurrence.scheduledFor, lockedTemplate.frequency);
        }
        lockedTemplate.consecutiveFailureCount = 0;
      } else {
        const retryAt = new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(occurrence.attemptCount - 1, RETRY_BACKOFF_MS.length - 1)]);
        await manager.query(
          `UPDATE recurring_order_occurrences
           SET status = 'failed', claimed_at = NULL, next_attempt_at = $2,
               last_error = $3, updated_at = now()
           WHERE id = $1 AND status = 'processing'`,
          [occurrence.id, retryAt, reason],
        );
        lockedTemplate.consecutiveFailureCount = occurrence.attemptCount;
      }
      lockedTemplate.lastFailureReason = reason;
      lockedTemplate.lastFailedAt = new Date();
      await manager.save(lockedTemplate);
    });

    if (exhausted) {
      this.eventEmitter.emit(
        RECURRING_TEMPLATE_GENERATION_FAILING_EVENT,
        new RecurringTemplateGenerationFailingEvent(
          template.id,
          template.customerId,
          occurrence.attemptCount,
          reason,
        ),
      );
    }
  }
}
