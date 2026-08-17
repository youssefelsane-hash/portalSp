import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  RECURRING_TEMPLATE_GENERATION_FAILING_EVENT,
  RecurringTemplateGenerationFailingEvent,
} from '../../common/events/recurring-template-generation-failing.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { TechniciansService } from '../technicians/technicians.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRecurringTemplateDto } from './dto/create-recurring-template.dto';
import { UpdateRecurringTemplateDto } from './dto/update-recurring-template.dto';
import { BookingMode, OrderType } from './entities/order.entity';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { OrdersService } from './orders.service';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 25;
const CLAIM_LEASE_MS = 5 * 60_000;

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

// آخر يوم فعلي في شهر (UTC) — بيتحسب بـ"اليوم صفر" من الشهر اللي بعده (خدعة JS Date معروفة).
function lastDayOfUtcMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

// كانت بَقّة حقيقية: `setMonth(getMonth() + 1)`/`setFullYear(getFullYear() + 1)` بتفيض بصمت لو
// اليوم مش موجود في الشهر الجديد (31 يناير + شهر = JS بتحسبها "31 فبراير" فتتدحرج لـ3 مارس، مش
// آخر يوم في فبراير زي المتوقع؛ 29 فبراير (سنة كبيسة) + سنة = 1 مارس مش 28 فبراير). الأثر: طلب
// متكرر شهري مضبوط يوم 29/30/31 كان بيتزحلق تاريخه شهر بعد شهر بدل ما يفضل ثابت على آخر يوم في
// الشهر. الإصلاح: نحسب الشهر/السنة الجديدة على "اليوم 1" الأول (مفيش فيضان ممكن)، وبعدين نـclamp
// اليوم المطلوب لآخر يوم فعلي في الشهر الجديد.
function nextOccurrence(from: Date, frequency: RecurringOrderFrequency): Date {
  const day = from.getUTCDate();
  switch (frequency) {
    case RecurringOrderFrequency.WEEKLY: {
      const next = new Date(from);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case RecurringOrderFrequency.MONTHLY: {
      const year = from.getUTCFullYear();
      const monthIndex0 = from.getUTCMonth() + 1;
      const clampedDay = Math.min(day, lastDayOfUtcMonth(year, monthIndex0));
      const next = new Date(from);
      next.setUTCFullYear(year, monthIndex0, clampedDay);
      return next;
    }
    case RecurringOrderFrequency.YEARLY: {
      const year = from.getUTCFullYear() + 1;
      const monthIndex0 = from.getUTCMonth();
      const clampedDay = Math.min(day, lastDayOfUtcMonth(year, monthIndex0));
      const next = new Date(from);
      next.setUTCFullYear(year, monthIndex0, clampedDay);
      return next;
    }
  }
}

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

    const startsAt = new Date(dto.starts_at);
    if (startsAt.getTime() <= Date.now()) {
      throw new ApiException(ErrorCode.VAL_001, 'أول موعد تنفيذ لازم يكون في المستقبل', HttpStatus.BAD_REQUEST);
    }

    const template = this.templates.create({
      customerId: customerProfile.id,
      serviceId: dto.service_id,
      addressId: dto.address_id,
      bookingMode: dto.booking_mode,
      requestedTechnicianId: dto.requested_technician_id ?? null,
      frequency: dto.frequency,
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

  // للأدمن/التشغيل بس (docs/08 §32: وضوح الطلبات المتكررة) — كانت فجوة موثّقة صراحة: مفيش أي
  // مسار للأدمن يشوف القوالب المتكررة خالص، فمينفعش يتابع/يشخّص قالب معطوب (consecutive_failure_count/
  // last_failure_reason/last_failed_at — راجع generateFromTemplate()/recordFailure() فوق).
  async listAllForAdmin(
    isActive: boolean | undefined,
    page: number,
    perPage: number,
  ): Promise<{ items: RecurringOrderTemplate[]; meta: { page: number; per_page: number; total: number } }> {
    const where: FindOptionsWhere<RecurringOrderTemplate> = {};
    if (isActive !== undefined) where.isActive = isActive;
    const [items, total] = await this.templates.findAndCount({
      where,
      order: { nextRunAt: 'ASC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items, meta: { page, per_page: perPage, total } };
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

  async sweep(): Promise<number> {
    await this.materializeDueOccurrences(SWEEP_BATCH_SIZE);
    const occurrences = await this.claimOccurrences(SWEEP_BATCH_SIZE);

    let generatedCount = 0;
    for (const occurrence of occurrences) {
      if (await this.processOccurrence(occurrence)) generatedCount++;
    }
    if (generatedCount > 0) {
      this.logger.log(`الطلبات المتكررة: ${generatedCount} طلب اتولّد تلقائيًا`);
    }
    return generatedCount;
  }

  private async materializeDueOccurrences(limit: number): Promise<void> {
    await this.templates.manager.query(
      `WITH due AS (
         SELECT id, next_run_at
         FROM recurring_order_templates
         WHERE is_active = true AND deleted_at IS NULL AND next_run_at <= now()
         ORDER BY next_run_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       INSERT INTO recurring_order_occurrences (template_id, scheduled_for)
       SELECT id, next_run_at FROM due
       ON CONFLICT (template_id, scheduled_for) DO NOTHING`,
      [limit],
    );
  }

  private async claimOccurrences(limit: number): Promise<ClaimedOccurrence[]> {
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
      [limit, MAX_CONSECUTIVE_FAILURES, CLAIM_LEASE_MS],
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
      problem_description: template.problemDescription ?? undefined,
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
