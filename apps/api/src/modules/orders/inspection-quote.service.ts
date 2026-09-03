import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import {
  ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT,
  OrderQuoteAboveRangeSubmittedEvent,
} from '../../common/events/order-quote-above-range-submitted.event';
import { CatalogService } from '../catalog/catalog.service';
import { PricingModel, Service } from '../catalog/entities/service.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PaymentsService } from '../payments/payments.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { OrderPriceStatus } from './entities/order.entity';
import { OrderQuote, OrderQuoteSource, OrderQuoteStatus } from './entities/order-quote.entity';

export interface InitialQuoteDetails {
  diagnosis?: string;
  scopeIncluded?: string;
  scopeExcluded?: string;
  estimatedDurationMinutes?: number;
  requiredTechnicians?: number;
  requiredAssistants?: number;
  revisionReason?: string;
}

// معاينة-ثم-سعر (ADR-0044، docs/08 §73 بند 1) — وضع حجز لخدمات سعرها مش معروف مقدمًا
// (service.pricing_model=inspection_then_quote): العميل بيدفع رسم المعاينة بس وقت الحجز
// (CatalogService.estimate() فرع مخصوص)، الفني يعاين المكان فعليًا، بعدين يحدد سعر أول للشغل —
// العميل يوافق أو يلغي. مختلفة عمداً عن order-items.service.ts (دي بتضيف "شغل إضافي" على سعر
// مؤسَّس بالفعل أثناء شغل شغال؛ دي بتؤسس أول سعر لطلب لسه بلا سعر) — راجع ADR-0044 قسم
// "البدائل اللي اتقيّمت" ليه اتقرر تفرقة الحالتين بدل تعميم order-items.
@Injectable()
export class InspectionQuoteService {
  private readonly logger = new Logger(InspectionQuoteService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly catalogService: CatalogService,
    private readonly paymentsService: PaymentsService,
    private readonly events: EventEmitter2,
    private readonly orderFinancials: OrderFinancialFinalizationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * بوابة «السعر خارج النطاق يروح لمراجعة الأدمن» (بند 33 من سكربت المالك، ADR-0063).
   *
   * بتسري على عروض **الفني** بس (معاينة بالموقع أو تعديل بعد التشخيص). عرض الأدمن نفسه
   * مابيتعرضش على الأدمن تاني — هو اللي كتبه.
   *
   * المرجع اللي بنقيس عليه بالترتيب:
   *   1. سقف النطاق التقديري المحفوظ على الطلب (`display_price_max_cents_snapshot`).
   *   2. لو مفيش نطاق: قيمة آخر عرض **معتمد** — يعني الفني بيزوّد على سعر العميل وافق عليه.
   *   3. لو مفيش لا ده ولا ده: مفيش مرجع نحكم بيه، فمفيش بوابة (صفر تغيير سلوك للخدمات اللي
   *      مالهاش نطاق النهاردة).
   *
   * السماح = المرجع + `max_quote_increase_without_admin_review_bps`. الافتراضي 0 نقطة أساس،
   * يعني أي مليم فوق النطاق بيروح مراجعة — وده المقصود من `require_admin_review_above_range`
   * الافتراضية `true`. الرقم من الإعدادات مش ثابت في الكود.
   */
  private async resolveQuoteStatus(
    manager: EntityManager,
    order: Order,
    service: Service,
    source: OrderQuoteSource,
    amountCents: number,
  ): Promise<OrderQuoteStatus> {
    if (source === OrderQuoteSource.ADMIN_REMOTE) return OrderQuoteStatus.PENDING_CUSTOMER;
    if (!service.requireAdminReviewAboveRange) return OrderQuoteStatus.PENDING_CUSTOMER;

    let referenceCents = order.displayPriceMaxCentsSnapshot;
    if (referenceCents == null) {
      const [approved] = await manager.query<{ amount_cents: number }[]>(
        `SELECT amount_cents
           FROM order_quotes
          WHERE order_id = $1 AND status = $2
          ORDER BY version DESC
          LIMIT 1`,
        [order.id, OrderQuoteStatus.APPROVED],
      );
      referenceCents = approved?.amount_cents ?? null;
    }
    if (referenceCents == null) return OrderQuoteStatus.PENDING_CUSTOMER;

    const allowanceCents = Math.round(
      referenceCents * (1 + service.maxQuoteIncreaseWithoutAdminReviewBps / 10_000),
    );
    return amountCents > allowanceCents ? OrderQuoteStatus.PENDING_ADMIN_REVIEW : OrderQuoteStatus.PENDING_CUSTOMER;
  }

  private async createQuoteVersion(
    manager: EntityManager,
    order: Order,
    submittedByUserId: string,
    source: OrderQuoteSource,
    amountCents: number,
    validityMinutes: number,
    details: InitialQuoteDetails,
    status: OrderQuoteStatus = OrderQuoteStatus.PENDING_CUSTOMER,
  ): Promise<OrderQuote> {
    const [{ next_version }] = await manager.query<{ next_version: string }[]>(
      `SELECT (COALESCE(MAX(version), 0) + 1)::text AS next_version
         FROM order_quotes
        WHERE order_id = $1`,
      [order.id],
    );
    const quote = manager.create(OrderQuote, {
      orderId: order.id,
      version: Number(next_version),
      source,
      status,
      amountCents,
      diagnosis: details.diagnosis?.trim() || null,
      scopeIncluded: details.scopeIncluded?.trim() || null,
      scopeExcluded: details.scopeExcluded?.trim() || null,
      estimatedDurationMinutes: details.estimatedDurationMinutes ?? null,
      requiredTechnicians: details.requiredTechnicians ?? null,
      requiredAssistants: details.requiredAssistants ?? null,
      expectedMinCents: order.displayPriceMinCentsSnapshot,
      expectedMaxCents: order.displayPriceMaxCentsSnapshot,
      revisionReason: details.revisionReason?.trim() || null,
      submittedByUserId,
      adminDecidedByUserId: null,
      adminDecidedAt: null,
      customerDecidedByUserId: null,
      customerDecidedAt: null,
      validUntil: new Date(Date.now() + validityMinutes * 60_000),
    });
    return manager.save(quote);
  }

  /**
   * ADR-0067 §2 — **الكاتب الوحيد** اللي بيعلّم عرض إنه منتهي الصلاحية.
   *
   * تلات مسارات بتوصل هنا: الكاسح الدوري (`QuoteExpiryService`)، ومحاولة موافقة العميل بعد
   * الميعاد، وإعادة إصدار الأدمن. قبل كده كان كل واحد فيهم كاتب السطرين بنفسه — وده بالظبط نوع
   * التكرار اللي بيفضل متطابق لحد أول تعديل في واحد بس منهم.
   *
   * **مابيغيّرش حالة الطلب** عمدًا: الطلب بيفضل في `AWAITING_INITIAL_QUOTE_APPROVAL` و`price_status`
   * بيرجع `waiting_quote` — نفس السلوك اللي المسار الكسول كان بيعمله من يوم ما اتكتب.
   */
  async expireQuoteInTransaction(manager: EntityManager, order: Order, quote: OrderQuote): Promise<void> {
    quote.status = OrderQuoteStatus.EXPIRED;
    order.priceStatus = OrderPriceStatus.WAITING_QUOTE;
    await manager.save(quote);
    await manager.save(order);
  }

  /**
   * ADR-0067 §1 — نقطة بث واحدة لـ«سعر خارج النطاق مستني الأدمن»، بينادوها المسارين اللي
   * `resolveQuoteStatus` بترجعلهم `PENDING_ADMIN_REVIEW` (عرض أول بعد المعاينة، وتعديل بعد
   * التشخيص). بتتنادى **بعد** نجاح الترانزاكشن بس.
   */
  private emitAboveRangeSubmitted(order: Order, quote: OrderQuote): void {
    this.events.emit(
      ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT,
      new OrderQuoteAboveRangeSubmittedEvent(
        order.id,
        order.orderNumber,
        quote.id,
        quote.amountCents,
        quote.expectedMaxCents,
      ),
    );
  }

  private assessmentCreditFor(order: Order, quoteAmountCents: number): number {
    const feeCents = order.assessmentType === 'remote' ? order.remoteAssessmentFeeCents : order.inspectionFeeCents;
    if (feeCents <= 0 || order.assessmentFeeCreditModeSnapshot === 'none') return 0;
    const requestedCredit =
      order.assessmentFeeCreditModeSnapshot === 'full'
        ? feeCents
        : Math.round((feeCents * order.assessmentFeeCreditBpsSnapshot) / 10_000);
    return Math.min(quoteAmountCents, requestedCredit);
  }

  /**
   * **بند 35 — «تعديل السعر بعد التشخيص» (Quote Revision).**
   *
   * الفني وصل، شخّص، ولقى الشغل مختلف عن اللي اتسعّر. ده **مش «شغل إضافي»**: الشغل الإضافي
   * (`order_items`) بيتضاف **أثناء التنفيذ** فوق سعر شغّال، أما ده بيصحّح **سعر الشغل الأساسي
   * نفسه قبل ما يبدأ**. خلطهم كان هيخلي بند واحد بمعنيين.
   *
   * `OrderQuoteSource.TECHNICIAN_DIAGNOSIS` كانت قيمة enum معرّفة **بلا أي تنفيذ** — لا خدمة ولا
   * endpoint ولا caller. دي هي.
   *
   * التخفيض على طلب مدفوع بيترفض **هنا** (وقت الإرسال) مش وقت الموافقة: الفني لازم يعرف فورًا،
   * والاسترداد مسار مالي مقصود لوحده مش أثر جانبي لتعديل سعر.
   */
  async submitDiagnosisRevision(
    technicianUserId: string,
    orderId: string,
    newAmountCents: number,
    reason: string,
    details: InitialQuoteDetails = {},
  ): Promise<Order> {
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(technicianUserId);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technician_id = :technicianId', {
          orderId,
          technicianId: technicianProfile.id,
        })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }
      if (![OrderStatus.TECHNICIAN_ARRIVED, OrderStatus.IN_PROGRESS].includes(order.orderStatus)) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'تعديل السعر بعد التشخيص متاح بعد ما توصل وقبل ما تخلّص الشغل بس',
          HttpStatus.CONFLICT,
        );
      }
      // تعديل السعر بيفترض إن فيه سعر أصلاً. طلب لسه بلا سعر ده مسار «عرض أول» مش «تعديل».
      const currentPriceCents = order.estimatedPriceCents;
      if (currentPriceCents == null) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'الطلب لسه مالوش سعر — ده مسار تحديد سعر أول مش تعديل بعد التشخيص',
          HttpStatus.CONFLICT,
        );
      }
      if (newAmountCents === currentPriceCents) {
        throw new ApiException(ErrorCode.VAL_001, 'السعر الجديد زي القديم', HttpStatus.BAD_REQUEST);
      }
      if (newAmountCents < currentPriceCents && order.paymentStatus === OrderPaymentStatus.PAID) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'الطلب مدفوع بالفعل — تخفيض السعر محتاج استرداد من الإدارة، مش تعديل سعر',
          HttpStatus.CONFLICT,
        );
      }
      if (
        order.settlementPolicyVersion === 2 &&
        order.platformCommissionCentsSnapshot != null &&
        order.platformCommissionCentsSnapshot > newAmountCents
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `السعر لازم يكون على الأقل ${order.platformCommissionCentsSnapshot} قرش عشان يغطي عمولة المنصة`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const service = await this.catalogService.findServiceOrThrow(order.serviceId);
      const quoteStatus = await this.resolveQuoteStatus(
        manager,
        order,
        service,
        OrderQuoteSource.TECHNICIAN_DIAGNOSIS,
        newAmountCents,
      );
      const quote = await this.createQuoteVersion(
        manager,
        order,
        technicianUserId,
        OrderQuoteSource.TECHNICIAN_DIAGNOSIS,
        newAmountCents,
        service.quoteValidityMinutes,
        { ...details, revisionReason: reason },
        quoteStatus,
      );

      const previousStatus = order.orderStatus;
      const needsAdminReview = quoteStatus === OrderQuoteStatus.PENDING_ADMIN_REVIEW;
      if (needsAdminReview) {
        // زي مسار المعاينة بالحرف: السعر الخارج عن النطاق مايوصلش العميل قبل قرار الإدارة،
        // والطلب بيفضل شغّال في مكانه.
        order.priceStatus = OrderPriceStatus.WAITING_QUOTE;
      } else {
        order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
        order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
      }
      await manager.save(order);

      if (!needsAdminReview) {
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: order.orderStatus,
            changedByUserId: technicianUserId,
            changedByRole: 'technician',
            changeSource: OrderChangeSource.TECHNICIAN,
            reason: `الفني عدّل السعر بعد التشخيص — ${newAmountCents} قرش`,
            metadata: {
              quote_id: quote.id,
              quote_version: quote.version,
              previous_price_cents: currentPriceCents,
              new_price_cents: newAmountCents,
              revision_reason: reason,
            },
          }),
        );
      }

      await this.auditLog.record(
        {
          actorUserId: technicianUserId,
          actorRole: 'technician',
          action: 'order.quote.diagnosis_revision_submitted',
          entityType: 'order_quote',
          entityId: quote.id,
          oldValues: { estimated_price_cents: currentPriceCents },
          newValues: {
            order_id: order.id,
            version: quote.version,
            amount_cents: newAmountCents,
            quote_status: quote.status,
            reason,
          },
        },
        manager,
      );
      return { order, previousStatus, quote, needsAdminReview };
    });

    if (result.order.orderStatus !== result.previousStatus) {
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          result.order.id,
          result.order.orderNumber,
          result.previousStatus,
          result.order.orderStatus,
          result.order.customerId,
          result.order.technicianId,
          'الفني عدّل السعر بعد التشخيص',
        ),
      );
    }
    if (result.needsAdminReview) {
      this.emitAboveRangeSubmitted(result.order, result.quote);
    }
    return result.order;
  }

  /**
   * بند 8 — «إعادة إصدار عرض منتهي الصلاحية».
   *
   * العرض المنتهي **مابيرجعش يشتغل** (ده كان هيخلي الصلاحية بلا معنى) — بيتعمل **إصدار جديد**
   * بنفس مصدر الأصلي، والأدمن هو اللي عمله. لو الأدمن ماحطش مبلغ جديد بيتاخد مبلغ العرض المنتهي
   * زي ما هو، وده الاستخدام الشائع (العميل اتأخر في الرد بس).
   *
   * موجودة هنا مش في `AssessmentTriageService` عشان `createQuoteVersion` تفضل **الكاتب الوحيد**
   * لأي إصدار عرض في المنظومة.
   */
  async reissueExpiredQuote(
    adminUserId: string,
    orderId: string,
    newAmountCents: number | undefined,
    meta?: AuditActorMeta,
  ): Promise<OrderQuote> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      const [latest] = await manager.find(OrderQuote, {
        where: { orderId },
        order: { version: 'DESC' },
        take: 1,
      });
      if (!latest) {
        throw new ApiException(ErrorCode.VAL_001, 'مفيش عرض سعر على الطلب ده', HttpStatus.NOT_FOUND);
      }
      const isExpired =
        latest.status === OrderQuoteStatus.EXPIRED ||
        (latest.status === OrderQuoteStatus.PENDING_CUSTOMER && latest.validUntil.getTime() <= Date.now());
      if (!isExpired) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'العرض ده لسه ساري — مفيش داعي لإعادة إصداره',
          HttpStatus.CONFLICT,
        );
      }
      // العرض القديم بيتقفل صراحة قبل ما نفتح واحد جديد — الـpartial unique index بيسمح بعرض
      // «حي» واحد بس لكل طلب.
      await this.expireQuoteInTransaction(manager, order, latest);

      const service = await this.catalogService.findServiceOrThrow(order.serviceId);
      const amountCents = newAmountCents ?? latest.amountCents;
      const quote = await this.createQuoteVersion(
        manager,
        order,
        adminUserId,
        latest.source,
        amountCents,
        service.quoteValidityMinutes,
        {
          diagnosis: latest.diagnosis ?? undefined,
          scopeIncluded: latest.scopeIncluded ?? undefined,
          scopeExcluded: latest.scopeExcluded ?? undefined,
          estimatedDurationMinutes: latest.estimatedDurationMinutes ?? undefined,
          requiredTechnicians: latest.requiredTechnicians ?? undefined,
          requiredAssistants: latest.requiredAssistants ?? undefined,
          revisionReason: `إعادة إصدار العرض رقم ${latest.version} بعد انتهاء صلاحيته`,
        },
        // الأدمن هو اللي أعاد الإصدار، فمفيش داعي يراجع نفسه.
        OrderQuoteStatus.PENDING_CUSTOMER,
      );

      const previousStatus = order.orderStatus;
      order.estimatedPriceCents = amountCents;
      order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
      if (order.orderStatus !== OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL) {
        if (!canTransition(order.orderStatus, OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL)) {
          throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
        }
        order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
      }
      await manager.save(order);

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.quote.reissued',
          entityType: 'order_quote',
          entityId: quote.id,
          oldValues: { expired_quote_id: latest.id, version: latest.version, amount_cents: latest.amountCents },
          newValues: { version: quote.version, amount_cents: amountCents, valid_until: quote.validUntil.toISOString() },
          meta,
        },
        manager,
      );
      return { order, quote, previousStatus };
    });

    if (result.order.orderStatus !== result.previousStatus) {
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          result.order.id,
          result.order.orderNumber,
          result.previousStatus,
          result.order.orderStatus,
          result.order.customerId,
          result.order.technicianId,
          'الإدارة أعادت إصدار عرض السعر',
        ),
      );
    }
    return result.quote;
  }

  async listQuotesForOrder(orderId: string): Promise<OrderQuote[]> {
    return this.dataSource.getRepository(OrderQuote).find({ where: { orderId }, order: { version: 'DESC' } });
  }

  async getCurrentQuoteForCustomer(userId: string, orderId: string): Promise<OrderQuote> {
    const customer = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId, customerId: customer.id } });
    if (!order) throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    const quote = await this.dataSource.getRepository(OrderQuote).findOne({ where: { orderId }, order: { version: 'DESC' } });
    if (!quote) throw new ApiException(ErrorCode.VAL_001, 'لا يوجد عرض سعر لهذا الطلب', HttpStatus.NOT_FOUND);
    return quote;
  }

  // الفني بيحدد السعر بعد ما وصل وعاين المكان فعليًا (TECHNICIAN_ARRIVED بس — نفس شرط
  // state machine). لازم الخدمة تكون فعلاً inspection_then_quote، وإلا الطلب أصلاً معندوش
  // سعر متأسس من الحجز ومفيش داعي للمسار ده.
  async submitInitialQuote(
    userId: string,
    orderId: string,
    quotedAmountCents: number,
    note?: string,
    details: InitialQuoteDetails = {},
  ): Promise<Order> {
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technician_id = :technicianId', { orderId, technicianId: technicianProfile.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }

      const service = await this.catalogService.findServiceOrThrow(order.serviceId);
      if (service.pricingModel !== PricingModel.INSPECTION_THEN_QUOTE) {
        throw new ApiException(ErrorCode.ORDR_003, 'الخدمة دي مش من نوع معاينة-ثم-سعر', HttpStatus.CONFLICT);
      }

      if (!canTransition(order.orderStatus, OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL)) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          `مينفعش تحدد سعر بعد المعاينة والطلب في حالة ${order.orderStatus}`,
          HttpStatus.CONFLICT,
        );
      }

      const previousStatus = order.orderStatus;
      const quoteStatus = await this.resolveQuoteStatus(
        manager,
        order,
        service,
        OrderQuoteSource.TECHNICIAN_ONSITE,
        quotedAmountCents,
      );
      const quote = await this.createQuoteVersion(
        manager,
        order,
        userId,
        OrderQuoteSource.TECHNICIAN_ONSITE,
        quotedAmountCents,
        service.quoteValidityMinutes,
        { ...details, diagnosis: details.diagnosis ?? note },
        quoteStatus,
      );
      const needsAdminReview = quoteStatus === OrderQuoteStatus.PENDING_ADMIN_REVIEW;
      order.initialQuoteSource = 'technician_onsite';
      order.initialQuoteNote = note?.trim() || null;
      if (needsAdminReview) {
        // السعر خارج النطاق: **مايوصلش العميل** قبل ما الأدمن يقرّر. الطلب بيفضل في حالته
        // التشغيلية زي ما هي (الفني لسه في المكان)، و`estimatedPriceCents` مابيتحطش عشان
        // مايظهرش للعميل سعر محدش اعتمده.
        order.priceStatus = OrderPriceStatus.WAITING_QUOTE;
      } else {
        order.estimatedPriceCents = quotedAmountCents;
        order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
        order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
      }
      await manager.save(order);

      // مفيش انتقال حالة لما العرض بيستنى الأدمن — التسجيل بيبقى في الـaudit تحت بس.
      if (!needsAdminReview) {
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
            changedByUserId: userId,
            changedByRole: 'technician',
            changeSource: OrderChangeSource.TECHNICIAN,
            reason: `الفني حدد سعر بعد المعاينة — ${quotedAmountCents} قرش`,
            metadata: {
              quote_id: quote.id,
              quote_version: quote.version,
              quoted_amount_cents: quotedAmountCents,
              valid_until: quote.validUntil.toISOString(),
              ...(note ? { note } : {}),
            },
          }),
        );
      }

      await this.auditLog.record(
        {
          actorUserId: userId,
          actorRole: 'technician',
          action: 'order.quote.submitted',
          entityType: 'order_quote',
          entityId: quote.id,
          newValues: {
            order_id: order.id,
            version: quote.version,
            source: quote.source,
            amount_cents: quotedAmountCents,
            quote_status: quote.status,
          },
        },
        manager,
      );

      return { order, previousStatus, quote, needsAdminReview };
    });

    const { order, previousStatus } = result;
    // العرض اللي راح لمراجعة الأدمن مابيغيّرش حالة الطلب، فمفيش حدث تغيير حالة يتبث عليه —
    // البث كان هيوصل للعميل إشعار عن انتقال ماحصلش. بس ده **مش** معناه إن الحدث ملوش وجود:
    // ADR-0067 §1 بيبعت حدث دومين مخصوص عشان الأدمن يعرف إن فيه قرار مستنيه.
    if (order.orderStatus !== previousStatus) {
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, order.orderStatus, order.customerId, order.technicianId),
      );
    }
    if (result.needsAdminReview) {
      this.emitAboveRangeSubmitted(order, result.quote);
    }

    return order;
  }

  async submitAdminRemoteQuote(
    adminUserId: string,
    orderId: string,
    quotedAmountCents: number,
    note?: string,
    details: InitialQuoteDetails = {},
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.orderStatus !== OrderStatus.AWAITING_ADMIN_QUOTE || order.initialQuoteSource !== 'admin_remote') {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش مستني تسعير الإدارة بالصور', HttpStatus.CONFLICT);
      }
      const service = await this.catalogService.findServiceOrThrow(order.serviceId);
      if (service.pricingModel !== PricingModel.INSPECTION_THEN_QUOTE) {
        throw new ApiException(ErrorCode.ORDR_003, 'الخدمة دي مش من نوع معاينة ثم سعر', HttpStatus.CONFLICT);
      }
      const [{ count }] = await manager.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count
           FROM order_media
          WHERE order_id = $1 AND media_type = 'problem_photo'`,
        [order.id],
      );
      if (Number(count) < 1) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب مفيهوش صور مشكلة كفاية للتسعير', HttpStatus.BAD_REQUEST);
      }
      if (
        order.settlementPolicyVersion === 2 &&
        order.platformCommissionCentsSnapshot != null &&
        order.platformCommissionCentsSnapshot > quotedAmountCents
      ) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `السعر لازم يكون على الأقل ${order.platformCommissionCentsSnapshot} قرش عشان يغطي عمولة المنصة`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const previousStatus = order.orderStatus;
      const quote = await this.createQuoteVersion(
        manager,
        order,
        adminUserId,
        OrderQuoteSource.ADMIN_REMOTE,
        quotedAmountCents,
        service.quoteValidityMinutes,
        { ...details, diagnosis: details.diagnosis ?? note },
      );
      order.estimatedPriceCents = quotedAmountCents;
      order.initialQuoteNote = note?.trim() || null;
      order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
      order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: order.orderStatus,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason: `الإدارة حددت السعر من الصور — ${quotedAmountCents} قرش`,
          metadata: {
            quote_id: quote.id,
            quote_version: quote.version,
            quoted_amount_cents: quotedAmountCents,
            valid_until: quote.validUntil.toISOString(),
            ...(note ? { note } : {}),
          },
        }),
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.remote_quote.submitted',
          entityType: 'order_quote',
          entityId: quote.id,
          newValues: { order_id: order.id, version: quote.version, source: quote.source, amount_cents: quotedAmountCents },
          meta,
        },
        manager,
      );
      return { order, previousStatus };
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        result.order.id,
        result.order.orderNumber,
        result.previousStatus,
        result.order.orderStatus,
        result.order.customerId,
        result.order.technicianId,
        `الإدارة حددت سعر الطلب من الصور`,
      ),
    );
    return result.order;
  }

  // العميل وافق على السعر بعد المعاينة — نفس نمط OrderItemsService.approve() بالضبط، بس
  // quotedAmountCents هنا هو order.estimated_price_cents كله (الشغل الأساسي نفسه)، مش بند
  // إضافي فوق سعر موجود. عشان كده commissionableBaseCents بيتزاد من غير شرط سياسة
  // includeAdditionalItems — راجع ADR-0044 §4 وcommission-base.ts (workPriceCents دايمًا
  // داخل الوعاء بلا شرط بتعريفه).
  async approveInitialQuote(
    userId: string,
    orderId: string,
    paymentChoice: 'cash' | 'electronic' = 'electronic',
  ): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.customer_id = :customerId', { orderId, customerId: customerProfile.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      const quote = await manager
        .createQueryBuilder(OrderQuote, 'q')
        .setLock('pessimistic_write')
        .where('q.order_id = :orderId', { orderId: order.id })
        .orderBy('q.version', 'DESC')
        .getOne();

      if (
        quote?.status === OrderQuoteStatus.APPROVED &&
        quote.customerDecidedByUserId === userId &&
        [OrderStatus.AWAITING_TECHNICIAN_SELECTION, OrderStatus.IN_PROGRESS].includes(order.orderStatus)
      ) {
        return { order, previousStatus: order.orderStatus, quotedAmountCents: 0, nextStatus: order.orderStatus, idempotent: true };
      }

      if (order.orderStatus !== OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL || !quote) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش سعر بعد معاينة مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
      }

      if (quote.status !== OrderQuoteStatus.PENDING_CUSTOMER) {
        throw new ApiException(ErrorCode.ORDR_003, 'عرض السعر الحالي مش متاح للموافقة', HttpStatus.CONFLICT);
      }
      if (quote.validUntil.getTime() <= Date.now()) {
        await this.expireQuoteInTransaction(manager, order, quote);
        return {
          order,
          previousStatus: order.orderStatus,
          quotedAmountCents: 0,
          nextStatus: order.orderStatus,
          idempotent: false,
          expired: true,
        };
      }

      const quotedAmountCents = quote.amountCents;
      const previousStatus = order.orderStatus;

      // **تعديل بعد التشخيص مختلف حسابيًا عن عرض أول** (بند 35): الطلب أصلاً عليه سعر شغل،
      // فاللي بيتضاف هو **الفرق** مش القيمة كلها. لو حسبناها زي العرض الأول كنا هنضيف السعر
      // الجديد كامل فوق القديم ونحصّل من العميل مرتين.
      const isDiagnosisRevision = quote.source === OrderQuoteSource.TECHNICIAN_DIAGNOSIS;
      const assessmentCreditCents = isDiagnosisRevision ? 0 : this.assessmentCreditFor(order, quotedAmountCents);
      const deltaCents = isDiagnosisRevision
        ? quotedAmountCents - (order.estimatedPriceCents ?? 0)
        : quotedAmountCents - assessmentCreditCents;

      if (isDiagnosisRevision && deltaCents < 0) {
        // التخفيض اتمنع وقت الإرسال لو الطلب مدفوع؛ الطلب غير المدفوع بيتصحّح سعره كاملاً بدل
        // ما يتزوّد بفرق سالب (increasePrice بترفض السالب أصلاً وده مقصود).
        //
        // بَقّة مالية حقيقية (بلاغ مالك 2026-09-03): كان بعد النداء ده سطر بيعدّل
        // `commissionable_base_cents` بنفس الفرق تاني — و`replaceUncommittedPrice` بتعدّله من
        // جوّاها أصلاً، فالفرق كان **بيتطبّق مرتين** وينزّل الوعاء لصفر (Math.max(0, …)). ووعاء
        // بصفر معناه `technician_earning = base - عمولة(base) = 0`، فالفني كان بيشوف «مستحقك
        // أنت: 0» على طلب سعره شغّال. مصدر واحد لتعديل الوعاء = الخدمة المالية، وبس.
        await this.orderFinancials.replaceUncommittedPrice(
          manager,
          order,
          order.totalAmountCents + deltaCents,
        );
      } else {
        await this.orderFinancials.increasePrice(manager, order, {
          amountCents: deltaCents,
          source: isDiagnosisRevision ? 'diagnosis_revision' : 'inspection_quote',
          includeInCommissionableBase: true,
          commissionableAmountCents: isDiagnosisRevision ? deltaCents : quotedAmountCents,
        });
      }
      if (isDiagnosisRevision) order.estimatedPriceCents = quotedAmountCents;

      const nextStatus = isDiagnosisRevision
        ? // الفني واقف في المكان ومستني موافقة على سعر شغل لسه ما بدأش — بيكمّل من مكانه.
          OrderStatus.IN_PROGRESS
        : order.initialQuoteSource === 'admin_remote'
          ? OrderStatus.AWAITING_TECHNICIAN_SELECTION
          : order.onsiteAssessorExecutesWorkSnapshot
            ? OrderStatus.IN_PROGRESS
            : OrderStatus.AWAITING_TECHNICIAN_SELECTION;
      order.orderStatus = nextStatus;
      order.assessmentFeeCreditCents = assessmentCreditCents;
      order.priceStatus = nextStatus === OrderStatus.IN_PROGRESS ? OrderPriceStatus.LOCKED : OrderPriceStatus.CONFIRMED;
      quote.status = OrderQuoteStatus.APPROVED;
      quote.customerDecidedByUserId = userId;
      quote.customerDecidedAt = new Date();
      await manager.save(quote);
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: nextStatus,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason:
            order.initialQuoteSource === 'admin_remote'
              ? `العميل وافق على السعر المحدد من الصور — ${quotedAmountCents} قرش`
              : `العميل وافق على السعر بعد المعاينة — ${quotedAmountCents} قرش`,
          metadata: {
            quote_id: quote.id,
            quote_version: quote.version,
            quoted_amount_cents: quotedAmountCents,
            assessment_credit_cents: assessmentCreditCents,
            net_added_cents: quotedAmountCents - assessmentCreditCents,
            quote_source: order.initialQuoteSource,
          },
        }),
      );

      await this.auditLog.record(
        {
          actorUserId: userId,
          actorRole: 'customer',
          action: 'order.quote.approved',
          entityType: 'order_quote',
          entityId: quote.id,
          oldValues: { status: OrderQuoteStatus.PENDING_CUSTOMER },
          newValues: {
            status: OrderQuoteStatus.APPROVED,
            amount_cents: quotedAmountCents,
            assessment_credit_cents: assessmentCreditCents,
          },
        },
        manager,
      );

      return { order, previousStatus, quotedAmountCents, nextStatus, idempotent: false, expired: false };
    });

    const { order, previousStatus, quotedAmountCents, nextStatus } = result;

    if ('expired' in result && result.expired) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتهت صلاحية عرض السعر — اطلب عرضًا محدثًا', HttpStatus.CONFLICT);
    }

    if (result.idempotent) return order;

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        nextStatus,
        order.customerId,
        order.technicianId,
        `العميل وافق على السعر بعد المعاينة — ${quotedAmountCents} قرش`,
      ),
    );

    // تحصيل فوري (docs/08 §21 نفس النمط) — برّه الـtransaction عمداً، فشله ميرجّعش خطأ للعميل
    // ولا بيرجع الموافقة اللي اتسجّلت بالفعل. batchId هنا مجرد مفتاح idempotency (مش بيتفحص ضد order_items).
    if (order.paymentStatus === OrderPaymentStatus.PAID && paymentChoice === 'electronic' && quotedAmountCents > 0) {
      try {
        await this.paymentsService.attemptAdditionalWorkCharge(order.id, randomUUID(), quotedAmountCents);
      } catch (err) {
        this.logger.error(
          `فشل محاولة تحصيل سعر بعد المعاينة للطلب ${order.id} — المبلغ يفضل obligation مسجّل`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return order;
  }
}
