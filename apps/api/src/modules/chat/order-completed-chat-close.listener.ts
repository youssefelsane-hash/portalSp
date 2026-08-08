import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { ChatService } from './chat.service';

@Injectable()
export class OrderCompletedChatCloseListener {
  private readonly logger = new Logger(OrderCompletedChatCloseListener.name);

  constructor(private readonly chatService: ChatService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (event.newStatus !== OrderStatus.COMPLETED) return;
    try {
      await this.chatService.scheduleCloseForOrder(event.orderId);
    } catch (err) {
      this.logger.error(`فشل جدولة قفل شات الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
