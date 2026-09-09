import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { MarketingService } from '../marketing.service';

const CANCELLING_STATUSES = new Set<OrderStatus>([
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.REFUNDED,
]);

/**
 * احتساب/إلغاء مستحق مصدر التسويق مع حالة الطلب (ADR-0082 §5).
 *
 * **نفس الحدث الموجود** (`ORDER_STATUS_CHANGED_EVENT`) مش حدث جديد — بيتصدر من نقاط إتمام
 * الدفع الثلاثة في `payments.service.ts`، وهو اللي `technician-referrals` ماشي عليه بالفعل.
 *
 * أي فشل هنا **مايكسرش الطلب**: العمولة رقم إداري، والشغلانة اتمّت فعلاً. الاسترداد لو الحدث
 * ضاع بيحصل من إعادة الحساب في التقرير، مش من تعليق الطلب.
 */
@Injectable()
export class MarketingOrderStatusListener {
  private readonly logger = new Logger(MarketingOrderStatusListener.name);

  constructor(private readonly marketing: MarketingService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handle(event: OrderStatusChangedEvent): Promise<void> {
    try {
      if (CANCELLING_STATUSES.has(event.newStatus)) {
        await this.marketing.cancelCommissionForOrder(event.orderId);
        return;
      }
      if (event.newStatus === OrderStatus.COMPLETED) {
        await this.marketing.accrueCommissionForOrder(event.orderId);
      }
    } catch (err) {
      this.logger.error(
        `فشل معالجة مستحق تسويق للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
