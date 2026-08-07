import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { MatchingService } from './matching.service';

@Injectable()
export class OrderDispatchListener {
  private readonly logger = new Logger(OrderDispatchListener.name);

  constructor(private readonly matchingService: MatchingService) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      await this.matchingService.dispatchNextRound(event.orderId);
    } catch (err) {
      this.logger.error(`فشل توزيع الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
