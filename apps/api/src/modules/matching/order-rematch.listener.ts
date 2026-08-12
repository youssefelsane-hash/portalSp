import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_REMATCH_REQUESTED_EVENT, OrderRematchRequestedEvent } from '../../common/events/order-rematch-requested.event';
import { MatchingService } from './matching.service';

// سياسة إلغاء الفني (docs/10) — orders module بيصدّر الحدث ده بعد إعادة مطابقة تلقائية (إلغاء
// طوارئ/auto-match) أو طلب عميل صريح لإعادة المطابقة (awaiting_technician_reselection) — نفس
// نمط OrderDispatchListener بالضبط (ORDER_CREATED_EVENT)، حدود الموديولات محفوظة.
@Injectable()
export class OrderRematchListener {
  private readonly logger = new Logger(OrderRematchListener.name);

  constructor(private readonly matchingService: MatchingService) {}

  @OnEvent(ORDER_REMATCH_REQUESTED_EVENT)
  async handleRematchRequested(event: OrderRematchRequestedEvent): Promise<void> {
    try {
      await this.matchingService.dispatchNextRound(event.orderId);
    } catch (err) {
      this.logger.error(`فشل إعادة توزيع الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
