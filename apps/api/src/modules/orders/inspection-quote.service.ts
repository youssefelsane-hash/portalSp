import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { CatalogService } from '../catalog/catalog.service';
import { PricingModel } from '../catalog/entities/service.entity';
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

  private async createQuoteVersion(
    manager: EntityManager,
    order: Order,
    submittedByUserId: string,
    source: OrderQuoteSource,
    amountCents: number,
    validityMinutes: number,
    details: InitialQuoteDetails,
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
      status: OrderQuoteStatus.PENDING_CUSTOMER,
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

  private assessmentCreditFor(order: Order, quoteAmountCents: number): number {
    const feeCents = order.assessmentType === 'remote' ? order.remoteAssessmentFeeCents : order.inspectionFeeCents;
    if (feeCents <= 0 || order.assessmentFeeCreditModeSnapshot === 'none') return 0;
    const requestedCredit =
      order.assessmentFeeCreditModeSnapshot === 'full'
        ? feeCents
        : Math.round((feeCents * order.assessmentFeeCreditBpsSnapshot) / 10_000);
    return Math.min(quoteAmountCents, requestedCredit);
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
      const quote = await this.createQuoteVersion(
        manager,
        order,
        userId,
        OrderQuoteSource.TECHNICIAN_ONSITE,
        quotedAmountCents,
        service.quoteValidityMinutes,
        { ...details, diagnosis: details.diagnosis ?? note },
      );
      order.estimatedPriceCents = quotedAmountCents;
      order.initialQuoteSource = 'technician_onsite';
      order.initialQuoteNote = note?.trim() || null;
      order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
      order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
      await manager.save(order);

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

      await this.auditLog.record(
        {
          actorUserId: userId,
          actorRole: 'technician',
          action: 'order.quote.submitted',
          entityType: 'order_quote',
          entityId: quote.id,
          newValues: { order_id: order.id, version: quote.version, source: quote.source, amount_cents: quotedAmountCents },
        },
        manager,
      );

      return { order, previousStatus };
    });

    const { order, previousStatus } = result;
    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, order.orderStatus, order.customerId, order.technicianId),
    );

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
        quote.status = OrderQuoteStatus.EXPIRED;
        order.priceStatus = OrderPriceStatus.WAITING_QUOTE;
        await manager.save(quote);
        await manager.save(order);
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

      const assessmentCreditCents = this.assessmentCreditFor(order, quotedAmountCents);

      await this.orderFinancials.increasePrice(manager, order, {
        amountCents: quotedAmountCents - assessmentCreditCents,
        source: 'inspection_quote',
        includeInCommissionableBase: true,
        commissionableAmountCents: quotedAmountCents,
      });
      const nextStatus =
        order.initialQuoteSource === 'admin_remote'
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
