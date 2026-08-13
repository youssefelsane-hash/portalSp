import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../common/events/order-accepted.event';
import { AssistantMatchingService } from './assistant-matching.service';

// لحظة قبول الفني القائد للطلب هي أول لحظة نعرف فيها القائد أصلاً — نفس نقطة الانطلاق
// المحدّدة في ADR-0007. لو الطلب مش محتاج مساعد (required_assistants=0/null)، startMatching()
// بترجع فورًا من غير أي بث.
@Injectable()
export class OrderAcceptedAssistantMatchingListener {
  private readonly logger = new Logger(OrderAcceptedAssistantMatchingListener.name);

  constructor(private readonly assistantMatchingService: AssistantMatchingService) {}

  @OnEvent(ORDER_ACCEPTED_EVENT)
  async handleOrderAccepted(event: OrderAcceptedEvent): Promise<void> {
    try {
      await this.assistantMatchingService.startMatching(event.orderId);
    } catch (err) {
      this.logger.error(`فشل بدء مطابقة المساعد للطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
