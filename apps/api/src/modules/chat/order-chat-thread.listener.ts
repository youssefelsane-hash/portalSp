import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../common/events/order-accepted.event';
import { ChatService } from './chat.service';

@Injectable()
export class OrderChatThreadListener {
  constructor(private readonly chatService: ChatService) {}

  @OnEvent(ORDER_ACCEPTED_EVENT)
  async handleOrderAccepted(event: OrderAcceptedEvent): Promise<void> {
    await this.chatService.createThreadForOrder(event.orderId, event.customerId, event.technicianId);
  }
}
