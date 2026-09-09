import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { PromoCodeLinksService } from '../promo-code-links.service';

const CANCELLING_STATUSES = new Set<OrderStatus>([
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.REFUNDED,
]);

/** مستحق الشريك يتبع اكتمال الطلب فقط، ولا يلمس توزيع المنصة أو الفني أو مبلغ العميل. */
@Injectable()
export class PromoMarketingOrderStatusListener {
  private readonly logger = new Logger(PromoMarketingOrderStatusListener.name);

  constructor(private readonly links: PromoCodeLinksService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handle(event: OrderStatusChangedEvent): Promise<void> {
    try {
      if (CANCELLING_STATUSES.has(event.newStatus)) {
        await this.links.cancelCommissionForOrder(event.orderId);
      } else if (event.newStatus === OrderStatus.COMPLETED) {
        await this.links.accrueCommissionForOrder(event.orderId);
      }
    } catch (err) {
      this.logger.error(`فشل معالجة مستحق كود تسويقي للطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
