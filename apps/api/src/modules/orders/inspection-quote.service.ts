import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
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

      order.totalAmountCents += quotedAmountCents;
      if (order.commissionableBaseCents !== null) {
        order.commissionableBaseCents += quotedAmountCents;
      }
      order.orderStatus = OrderStatus.IN_PROGRESS;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.IN_PROGRESS,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: `العميل وافق على السعر بعد المعاينة — ${quotedAmountCents} قرش`,
          metadata: { quoted_amount_cents: quotedAmountCents },
        }),
      );

      return { order, previousStatus, quotedAmountCents };
    });

    const { order, previousStatus, quotedAmountCents } = result;

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.IN_PROGRESS,
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
