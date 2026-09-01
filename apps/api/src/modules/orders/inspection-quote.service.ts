import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { CatalogService } from '../catalog/catalog.service';
import { PricingModel } from '../catalog/entities/service.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PaymentsService } from '../payments/payments.service';
import { TechniciansService } from '../technicians/technicians.service';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';

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
  ) {}

  // الفني بيحدد السعر بعد ما وصل وعاين المكان فعليًا (TECHNICIAN_ARRIVED بس — نفس شرط
  // state machine). لازم الخدمة تكون فعلاً inspection_then_quote، وإلا الطلب أصلاً معندوش
  // سعر متأسس من الحجز ومفيش داعي للمسار ده.
  async submitInitialQuote(userId: string, orderId: string, quotedAmountCents: number, note?: string): Promise<Order> {
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
      order.estimatedPriceCents = quotedAmountCents;
      order.initialQuoteSource = 'technician_onsite';
      order.initialQuoteNote = note?.trim() || null;
      order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
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
          metadata: note ? { quoted_amount_cents: quotedAmountCents, note } : { quoted_amount_cents: quotedAmountCents },
        }),
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
      order.estimatedPriceCents = quotedAmountCents;
      order.initialQuoteNote = note?.trim() || null;
      order.orderStatus = OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL;
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
          metadata: note ? { quoted_amount_cents: quotedAmountCents, note } : { quoted_amount_cents: quotedAmountCents },
        }),
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
      if (order.orderStatus !== OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش سعر بعد معاينة مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
      }

      const quotedAmountCents = order.estimatedPriceCents ?? 0;
      const previousStatus = order.orderStatus;

      await this.orderFinancials.increasePrice(manager, order, {
        amountCents: quotedAmountCents,
        source: 'inspection_quote',
        includeInCommissionableBase: true,
      });
      const nextStatus =
        order.initialQuoteSource === 'admin_remote' ? OrderStatus.SEARCHING_TECHNICIAN : OrderStatus.IN_PROGRESS;
      order.orderStatus = nextStatus;
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
          metadata: { quoted_amount_cents: quotedAmountCents, quote_source: order.initialQuoteSource },
        }),
      );

      return { order, previousStatus, quotedAmountCents, nextStatus };
    });

    const { order, previousStatus, quotedAmountCents, nextStatus } = result;

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

    if (nextStatus === OrderStatus.SEARCHING_TECHNICIAN) {
      await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(order.id));
    }

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
