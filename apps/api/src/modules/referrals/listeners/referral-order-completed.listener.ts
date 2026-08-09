import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { ReferralsService } from '../referrals.service';

@Injectable()
export class ReferralOrderCompletedListener {
  private readonly logger = new Logger(ReferralOrderCompletedListener.name);

  constructor(private readonly referralsService: ReferralsService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handle(event: OrderStatusChangedEvent): Promise<void> {
    if (event.newStatus !== OrderStatus.COMPLETED) return; // مهتمين بس بلحظة اكتمال الطلب فعلياً
    try {
      await this.referralsService.handleOrderCompleted(event.customerId, event.orderId);
    } catch (err) {
      this.logger.error(`فشل معالجة اكتمال ترشيح للطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
