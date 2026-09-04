import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import {
  ORDER_ASSESSMENT_INFO_REQUESTED_EVENT,
  OrderAssessmentInfoRequestedEvent,
} from '../../common/events/order-assessment-info-requested.event';
import {
  ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT,
  OrderQuoteAboveRangeDecidedEvent,
} from '../../common/events/order-quote-above-range-decided.event';
import {
  ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT,
  OrderRoutedToOnsiteAssessmentEvent,
} from '../../common/events/order-routed-to-onsite-assessment.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { CatalogService } from '../catalog/catalog.service';
import { Order, OrderPriceStatus, OrderStatus } from './entities/order.entity';
import { OrderQuote, OrderQuoteStatus } from './entities/order-quote.entity';
import { OrderCustomerNotice, OrderCustomerNoticeType } from './entities/order-customer-notice.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';

/** فلاتر طابور «طلبات التقييم» في الأدمن (بند 7). */
export type AssessmentQueueFilter =
  | 'photo_review'
  | 'onsite_assessment'
  | 'awaiting_quote'
  | 'awaiting_customer'
  | 'above_range'
  | 'expired_quote';

export interface AssessmentQueueRow {
  order_id: string;
  order_number: string;
  service_name_ar: string;
  customer_name: string;
  order_status: string;
  price_status: string;
  assessment_type: string | null;
  created_at: string;
  /** آخر عرض على الطلب — null لو لسه مفيش عرض خالص. */
  latest_quote_id: string | null;
  latest_quote_status: string | null;
  latest_quote_amount_cents: number | null;
  latest_quote_valid_until: string | null;
  /** عدد صور المشكلة المربوطة بالطلب — بيخلّي فرز طلبات «التقييم بالصور» ممكن من الطابور نفسه. */
  problem_photo_count: number;
}

/**
 * **فرز التقييم في الأدمن (بنود 7 و8 من سكربت المالك).**
 *
 * `InspectionQuoteService` بتغطي «الأدمن سعّر من الصور» و«الفني سعّر بعد المعاينة» و«العميل وافق».
 * اللي كان ناقص هو القرارات اللي **مش تسعير**: الصور مش كفاية، ناقص معلومات، سعر الفني خرج عن
 * النطاق، والعرض خلصت صلاحيته.
 *
 * مش محرك عروض تاني: كتابة أي إصدار عرض بتفضل تمرّ من `InspectionQuoteService` (المصدر الوحيد)
 * عبر `reissueExpiredQuote` اللي بتناديها. الخدمة دي بتاخد **قرارات** بس.
 */
@Injectable()
export class AssessmentTriageService {
  private readonly logger = new Logger(AssessmentTriageService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly catalogService: CatalogService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  private async lockOrderOrThrow(manager: EntityManager, orderId: string): Promise<Order> {
    const order = await manager
      .createQueryBuilder(Order, 'o')
      .setLock('pessimistic_write')
      .where('o.id = :orderId', { orderId })
      .getOne();
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /**
   * بند 8 — «تحويل لمعاينة في الموقع»: الصور مش كفاية لتسعير عن بُعد.
   *
   * الطلب بيتوزّع على معاين زي أي طلب تاني (نفس محرك المطابقة، مفيش مسار توزيع تاني)، والسعر
   * بيتحدد بعد الزيارة من الفني نفسه.
   */
  async routeToOnsiteAssessment(
    adminUserId: string,
    orderId: string,
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrderOrThrow(manager, orderId);
      if (order.orderStatus !== OrderStatus.AWAITING_ADMIN_QUOTE) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في مرحلة فرز الصور', HttpStatus.CONFLICT);
      }
      const service = await this.catalogService.findServiceOrThrow(order.serviceId);
      if (!service.onsiteAssessmentEnabled) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'المعاينة في الموقع مش مفعّلة للخدمة دي — فعّلها من سياسة تحديد السعر والمعاينة الأول',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!canTransition(order.orderStatus, OrderStatus.SEARCHING_TECHNICIAN)) {
        throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
      }

      const previousStatus = order.orderStatus;
      const previousAssessmentType = order.assessmentType;
      order.assessmentType = 'onsite';
      // رسم المعاينة بالموقع بياخد قيمته من الخدمة **دلوقتي** لأن الطلب اتعمل أصلاً على مسار
      // «تقييم بالصور» فماكانش عليه رسم معاينة. بيتسجّل على الطلب عشان يفضل ثابت بعد كده.
      order.inspectionFeeCents = service.inspectionFeeCents;
      order.priceStatus = OrderPriceStatus.WAITING_ASSESSMENT;
      order.orderStatus = OrderStatus.SEARCHING_TECHNICIAN;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.SEARCHING_TECHNICIAN,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason: `الإدارة حوّلت الطلب لمعاينة في الموقع — ${reason}`,
          metadata: {
            previous_assessment_type: previousAssessmentType,
            inspection_fee_cents: order.inspectionFeeCents,
          },
        }),
      );
      // ADR-0071 — نفس النص اللي بيروح في الإشعار بيتخزّن على الطلب كمان. قبل كده كان في
      // `order_status_history.reason` بس، وده مسار أدمن مش معروض للعميل خالص — فالعميل كان
      // بيفتح الطلب ويلاقي إنه اتحوّل لمعاينة بلا أي سبب مكتوب (بلاغ مالك 2026-09-04).
      await manager.save(
        manager.create(OrderCustomerNotice, {
          orderId: order.id,
          noticeType: OrderCustomerNoticeType.ROUTED_TO_ONSITE_ASSESSMENT,
          message: reason,
          createdByUserId: adminUserId,
        }),
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.assessment.routed_to_onsite',
          entityType: 'order',
          entityId: order.id,
          oldValues: { order_status: previousStatus, assessment_type: previousAssessmentType },
          newValues: {
            order_status: OrderStatus.SEARCHING_TECHNICIAN,
            assessment_type: 'onsite',
            inspection_fee_cents: order.inspectionFeeCents,
            reason,
          },
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
        null,
        'الإدارة حوّلت الطلب لمعاينة في الموقع',
      ),
    );
    // الحالة الجديدة بتتشارك مع التوزيع العادي اللي مالوش إشعار عمدًا، فالعميل ماكانش بياخد أي
    // حاجة — رغم إن رسم معاينة اتضاف على طلبه (ADR-0067 §1).
    this.events.emit(
      ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT,
      new OrderRoutedToOnsiteAssessmentEvent(
        result.order.id,
        result.order.orderNumber,
        result.order.customerId,
        result.order.inspectionFeeCents,
        reason,
      ),
    );
    // التوزيع كله معلّق على الحدث ده (ADR-0018) — من غيره الطلب بيقف في SEARCHING_TECHNICIAN.
    await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(result.order.id));
    return result.order;
  }

  /**
   * بند 8 — «طلب معلومات إضافية»: الأدمن محتاج صور/تفاصيل أكتر قبل ما يسعّر.
   *
   * **مفيش انتقال حالة**: الطلب بيفضل مستني تسعير الإدارة، والعميل بياخد إشعار بالمطلوب منه.
   * لو غيّرنا الحالة كنا هنحتاج حالة جديدة كل قرار، وده انفجار حالات بلا مقابل (ADR-0063 بند 44).
   */
  async requestMoreInformation(
    adminUserId: string,
    orderId: string,
    message: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.dataSource.transaction(async (manager) => {
      const locked = await this.lockOrderOrThrow(manager, orderId);
      if (locked.orderStatus !== OrderStatus.AWAITING_ADMIN_QUOTE) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب مش في مرحلة فرز الصور', HttpStatus.CONFLICT);
      }
      // ADR-0071 — الفعل ده **مافيهوش انتقال حالة عمدًا**، فماكانش له ولا حتى صف في
      // `order_status_history`: نص الأدمن كان بيعيش في `audit_logs` والإشعار وبس. العميل يفتح
      // الطلب فيلاقي «محتاجين تفاصيل أكتر» بلا أي تفاصيل (بلاغ مالك 2026-09-04).
      await manager.save(
        manager.create(OrderCustomerNotice, {
          orderId: locked.id,
          noticeType: OrderCustomerNoticeType.INFO_REQUESTED,
          message,
          createdByUserId: adminUserId,
        }),
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.assessment.info_requested',
          entityType: 'order',
          entityId: locked.id,
          newValues: { message },
          meta,
        },
        manager,
      );
      return locked;
    });

    this.events.emit(
      ORDER_ASSESSMENT_INFO_REQUESTED_EVENT,
      new OrderAssessmentInfoRequestedEvent(order.id, order.orderNumber, order.customerId, message),
    );
    return order;
  }

  /**
   * بند 8 — قبول/رفض عرض سعر خرج عن النطاق.
   *
   * العرض ده اتحجز في `PENDING_ADMIN_REVIEW` وقت ما الفني بعته (بوابة
   * `InspectionQuoteService.resolveQuoteStatus`)، فالعميل **ماشافهوش** أصلاً.
   */
  async decideAboveRangeQuote(
    adminUserId: string,
    orderId: string,
    quoteId: string,
    approve: boolean,
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<OrderQuote> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrderOrThrow(manager, orderId);
      const quote = await manager.findOne(OrderQuote, { where: { id: quoteId, orderId } });
      if (!quote) {
        throw new ApiException(ErrorCode.VAL_001, 'عرض السعر غير موجود على الطلب ده', HttpStatus.NOT_FOUND);
      }
      if (quote.status !== OrderQuoteStatus.PENDING_ADMIN_REVIEW) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'العرض ده مش مستني مراجعة الإدارة',
          HttpStatus.CONFLICT,
        );
      }

      const previousStatus = order.orderStatus;
      quote.adminDecidedByUserId = adminUserId;
      quote.adminDecidedAt = new Date();

      if (approve) {
        const service = await this.catalogService.findServiceOrThrow(order.serviceId);
        quote.status = OrderQuoteStatus.PENDING_CUSTOMER;
        // مهلة العميل بتبدأ من لحظة اعتماد الأدمن، مش من لحظة إرسال الفني — العميل ماكانش شايف
        // العرض أصلاً طول فترة المراجعة.
        quote.validUntil = new Date(Date.now() + service.quoteValidityMinutes * 60_000);
        await manager.save(quote);

        order.estimatedPriceCents = quote.amountCents;
        order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
        order.priceStatus = OrderPriceStatus.WAITING_CUSTOMER_APPROVAL;
        await manager.save(order);
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
            changedByUserId: adminUserId,
            changedByRole: 'admin',
            changeSource: OrderChangeSource.ADMIN,
            reason: `الإدارة اعتمدت سعر خارج النطاق — ${quote.amountCents} قرش`,
            metadata: { quote_id: quote.id, quote_version: quote.version, decision_reason: reason },
          }),
        );
      } else {
        quote.status = OrderQuoteStatus.REJECTED;
        quote.revisionReason = reason;
        await manager.save(quote);
        // الطلب بيفضل في حالته التشغيلية؛ الفني هو اللي مطلوب منه سعر جديد.
        order.priceStatus = OrderPriceStatus.WAITING_QUOTE;
        await manager.save(order);
      }

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: approve ? 'order.quote.above_range_approved' : 'order.quote.above_range_rejected',
          entityType: 'order_quote',
          entityId: quote.id,
          oldValues: { status: OrderQuoteStatus.PENDING_ADMIN_REVIEW },
          newValues: { status: quote.status, amount_cents: quote.amountCents, reason },
          meta,
        },
        manager,
      );
      return { order, quote, previousStatus };
    });

    // الفني اللي بعت العرض لازم ياخد رد في الحالتين. مسار الرفض مابيغيّرش حالة الطلب خالص،
    // فماكانش بيتبعت عنه أي حدث والفني المطلوب منه سعر جديد ماكانش فيه حاجة تقوله (ADR-0067 §1).
    this.events.emit(
      ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT,
      new OrderQuoteAboveRangeDecidedEvent(
        result.order.id,
        result.order.orderNumber,
        result.quote.id,
        result.quote.amountCents,
        approve,
        reason,
        result.quote.submittedByUserId,
      ),
    );

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
          'الإدارة اعتمدت السعر',
        ),
      );
    }
    return result.quote;
  }

  /** بند 7 — طابور «طلبات التقييم» بفلاتره. */
  async listAssessmentQueue(filter?: AssessmentQueueFilter): Promise<AssessmentQueueRow[]> {
    const where: string[] = [`o.deleted_at IS NULL`];
    switch (filter) {
      case 'photo_review':
        where.push(`o.order_status = 'awaiting_admin_quote'`, `o.assessment_type = 'remote'`);
        break;
      case 'onsite_assessment':
        where.push(`o.assessment_type = 'onsite'`, `o.price_status = 'waiting_assessment'`);
        break;
      case 'awaiting_quote':
        where.push(`o.price_status = 'waiting_quote'`);
        break;
      case 'awaiting_customer':
        where.push(`o.order_status = 'awaiting_initial_quote_approval'`);
        break;
      case 'above_range':
        where.push(`lq.status = 'pending_admin_review'`);
        break;
      case 'expired_quote':
        where.push(`lq.status = 'expired'`);
        break;
      default:
        // بلا فلتر: كل طلب لسه سعره مش مستقر.
        where.push(`o.price_status <> 'confirmed'`);
    }

    return this.dataSource.query<AssessmentQueueRow[]>(
      `SELECT o.id                     AS order_id,
              o.order_number           AS order_number,
              s.name_ar                AS service_name_ar,
              u.full_name              AS customer_name,
              o.order_status::text     AS order_status,
              o.price_status           AS price_status,
              o.assessment_type        AS assessment_type,
              o.created_at             AS created_at,
              lq.id                    AS latest_quote_id,
              lq.status                AS latest_quote_status,
              lq.amount_cents          AS latest_quote_amount_cents,
              lq.valid_until           AS latest_quote_valid_until,
              -- بلاغ المالك «الصور ما بتطلعش من الطلب» (docs/08 §131): الطابور ده هو أول شاشة
              -- بيشوفها الأدمن لطلب تقييم، ومكانش فيه أي أثر للصور خالص — لا عدد ولا علامة —
              -- فمافيش طريقة يعرف منها إن الطلب أصلاً وصله صور يسعّر عليها غير إنه يفتح كل طلب
              -- واحد واحد. العدّاد ده بيخلّي الفرز ممكن من الطابور نفسه.
              COALESCE(pm.problem_photo_count, 0)::int AS problem_photo_count
         FROM orders o
         JOIN services s ON s.id = o.service_id
         JOIN customer_profiles cp ON cp.id = o.customer_id
         JOIN users u ON u.id = cp.user_id
         LEFT JOIN LATERAL (
              SELECT q.id, q.status, q.amount_cents, q.valid_until
                FROM order_quotes q
               WHERE q.order_id = o.id
               ORDER BY q.version DESC
               LIMIT 1
         ) lq ON true
         LEFT JOIN LATERAL (
              SELECT count(*) AS problem_photo_count
                FROM order_media m
               WHERE m.order_id = o.id AND m.media_type = 'problem_photo'
         ) pm ON true
        WHERE ${where.join(' AND ')}
        ORDER BY o.created_at ASC
        LIMIT 200`,
    );
  }
}
