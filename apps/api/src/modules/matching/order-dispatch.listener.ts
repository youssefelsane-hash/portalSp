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
      // نقطة الدخول الموحّدة (ADR-0018) — بتفرّق طوارئ/مجدول داخليًا وتوجّه لكل مسار صح. طوارئ
      // (استجابة فورية بالتعريف، ميقدرش يكون عندها scheduled_at خالص — orders.service.ts بيرفضها
      // صراحة) بتاخد دورة طلب/قبول-رفض (dispatchNextRound). أي طلب تاني (عادي أو "Quick Job")
      // بيتأكّد تلقائيًا فورًا وقت الإنشاء بلا انتظار قبول فني، بغض النظر عن قرب/بُعد اليوم
      // المطلوب — نفس نموذج الحجز المجدول العادي دايمًا.
      //
      // آلية تأجيل البث (ADR-0009 بند 1-2) اتشالت بالكامل في docs/08 §131 — الطابور والـworker
      // والإعداد والحقل في الحدث. كانت ميتة من ساعة ADR-0018: كل طلب غير طوارئ بيتأكّد فورًا،
      // وطلب الطوارئ ميقدرش يكون عنده `scheduled_at`، فالتأجيل ماكانش بيتحسب لأي طلب أبدًا.
      await this.matchingService.dispatchOrAutoConfirm(event.orderId);
    } catch (err) {
      this.logger.error(`فشل توزيع الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
