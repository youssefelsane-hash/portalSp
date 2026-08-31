import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { PricingModel } from '../catalog/entities/service.entity';
import { buildPricingContext } from '../pricing/pricing-context';
import { TechniciansService } from '../technicians/technicians.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRecurringTemplateDto } from './dto/create-recurring-template.dto';
import { UpdateRecurringTemplateDto } from './dto/update-recurring-template.dto';
import { BookingMode, OrderType } from './entities/order.entity';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { nextOccurrence } from './recurring-schedule.util';
import { OrdersService } from './orders.service';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 25;
const CLAIM_LEASE_MS = 5 * 60_000;
const MATERIALIZATION_LEAD_TIME_HOURS_FALLBACK = 96;

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
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل sweep الطلبات المتكررة', err instanceof Error ? err.stack : err));
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

    if ((service.pricingModel === PricingModel.PER_UNIT || service.pricingModel === PricingModel.MONTHLY) && dto.pricing_quantity == null) {
      throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد الكمية المطلوبة لخدمة محسوبة بالوحدة', HttpStatus.BAD_REQUEST);
    }
    if (service.pricingModel !== PricingModel.PER_UNIT && service.pricingModel !== PricingModel.MONTHLY && dto.pricing_quantity != null) {
      throw new ApiException(ErrorCode.VAL_001, 'كمية التسعير متاحة فقط للخدمات المحسوبة بالوحدة', HttpStatus.BAD_REQUEST);
    }

    // أوضاع التوقيت الأربعة (ADR-0032) — نفس فحوصات OrdersService.create() بالحرف: القالب اللي
    // هيتولّد منه طلب لازم يحمل نفس الحقول المطلوبة للوضع الفعّال، وإلا كل موعد هيترفض عند
    // إنشاء الطلب ويوصل dead-letter من غير فايدة. فحص مبكر هنا = رفض واضح وقت الإنشاء بدل فشل صامت مؤجل.
    if (service.requiresPreciseSchedule) {
      if (!dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد عدد الساعات المطلوبة لخدمة بدقة وقت', HttpStatus.BAD_REQUEST);
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else if (service.requiresHoursOnly) {
      if (!dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد عدد الساعات المطلوبة', HttpStatus.BAD_REQUEST);
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else if (service.requiresStartAndEnd) {
      if (!dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'لازم تحدد تاريخ ووقت نهاية الخدمة', HttpStatus.BAD_REQUEST);
      }
      if (dto.duration_hours) {
        throw new ApiException(ErrorCode.VAL_001, 'duration_hours مش مطلوبة لخدمة محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    } else {
      if (dto.duration_hours) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'duration_hours متاحة بس للخدمات اللي محتاجة دقة وقت أو عدد ساعات',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.scheduled_end_at) {
        throw new ApiException(ErrorCode.VAL_001, 'scheduled_end_at متاحة بس للخدمات اللي محتاجة بداية ونهاية', HttpStatus.BAD_REQUEST);
      }
    }

    const startsAt = new Date(dto.starts_at);
    if (startsAt.getTime() <= Date.now()) {
      throw new ApiException(ErrorCode.VAL_001, 'أول موعد تنفيذ لازم يكون في المستقبل', HttpStatus.BAD_REQUEST);
    }

    const pricingContext = buildPricingContext({
      quantity: dto.pricing_quantity,
      durationHours: dto.duration_hours,
      scheduledAt: startsAt,
      scheduledEndAt: dto.scheduled_end_at,
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
      frequency: dto.frequency,
      fieldValues: dto.field_values ?? null,
      pricingQuantity:
        service.pricingModel === PricingModel.PER_UNIT || service.pricingModel === PricingModel.MONTHLY
          ? String(dto.pricing_quantity)
          : null,
      durationHours: dto.duration_hours ?? null,
      durationMinutes: pricingContext.durationMinutes,
      scheduledEndAt: dto.scheduled_end_at ? new Date(dto.scheduled_end_at) : null,
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
    await this.materializeDueOccurrences(SWEEP_BATCH_SIZE, options?.templateIds);
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
      if (Boolean(status?.is_blocked || status?.deleted_at)) {
        throw new Error('العميل متبلوك/محذوف — التوليد موقوف لحد ما الحالة تتغير');
      }
    } catch (err) {
      await this.recordFailure(occurrence, template, err);
      return false;
    }

    const createOrderDto: CreateOrderDto = {
      service_id: template.serviceId,
      address_id: template.addressId,
      booking_mode: template.bookingMode,
      order_type: OrderType.RECURRING,
      requested_technician_id: template.requestedTechnicianId ?? undefined,
      requested_technician_company_id: template.requestedTechnicianCompanyId ?? undefined,
      problem_description: template.problemDescription ?? undefined,
      // occurrence.scheduledFor هو الموعد التجاري الحقيقي، مش metadata فقط. بدونه كان الطلب
      // المتكرر يتحول إلى ASAP ويأخذ رسوم/مطابقة نفس اليوم بالخطأ.
      scheduled_at: occurrence.scheduledFor.toISOString(),
      // مدخلات التسعير/التوقيت المحفوظة مع القالب (migration 0176) — **مدخلات مش سعر**: القيمة
      // الفعلية بيتحسبها محرك التسعير الحي جوّه OrdersService.create() وقت التوليد بالظبط، فتغيير
      // أسعار/قواعد الخدمة بيأثر على الطلبات الجديدة بس، والطلبات المتولّدة فعلاً بتحتفظ بـsnapshot
      // سعرها العادي زي أي طلب.
      field_values: template.fieldValues ?? undefined,
      pricing_quantity: template.pricingQuantity == null ? undefined : Number(template.pricingQuantity),
      duration_hours:
        template.durationMinutes == null
          ? (template.durationHours ?? undefined)
          : template.durationMinutes / 60,
      scheduled_end_at:
        template.scheduledEndAt && template.durationMinutes != null
          ? new Date(occurrence.scheduledFor.getTime() + template.durationMinutes * 60_000).toISOString()
          : undefined,
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
      if (order.orderStatus === 'pending_payment') {
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
