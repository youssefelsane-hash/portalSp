import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { MatchingDispatchQueueClient } from './matching-dispatch-queue.client';
import { MatchingService } from './matching.service';

@Injectable()
export class OrderDispatchListener {
  private readonly logger = new Logger(OrderDispatchListener.name);

  constructor(
    private readonly matchingService: MatchingService,
    private readonly dispatchQueue: MatchingDispatchQueueClient,
  ) {}

  /**
   * **التوزيع بقى وظيفة طابور، مش شغل جوّه طلب الـHTTP.**
   *
   * نقطة الدخول الموحّدة (ADR-0018) — بتفرّق طوارئ/مجدول داخليًا وتوجّه لكل مسار صح. طوارئ
   * (استجابة فورية بالتعريف، ميقدرش يكون عندها scheduled_at خالص — orders.service.ts بيرفضها
   * صراحة) بتاخد دورة طلب/قبول-رفض (dispatchNextRound). أي طلب تاني (عادي أو "Quick Job")
   * بيتأكّد تلقائيًا فورًا بلا انتظار قبول فني، بغض النظر عن قرب/بُعد اليوم المطلوب.
   *
   * اللي اتغيّر: النداء ده كان بيتنفّذ **في نفس عملية طلب الـHTTP**، فكل حجز كان بياخد اتصال
   * قاعدة تاني بلا أي سقف. الشرح الكامل والقياس في `matching-dispatch-queue.client.ts`.
   *
   * **الارتداد لو الطابور مش متاح**: لو Redis واقع، بننفّذ التوزيع مباشرة زي الأول. ده أسوأ من
   * ناحية الحِمل بس أحسن بكتير من طلب مايتوزّعش خالص — والحمل العالي وانقطاع Redis في نفس
   * اللحظة حالة نادرة، بينما «الطلب اتعمل ومحدش شافه» كارثة مباشرة. وبعدها كمان
   * `MatchingRecoveryService` بتمسح الطلبات العالقة دوريًا كشبكة تالتة.
   */
  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    if (await this.dispatchQueue.enqueueDispatch(event.orderId)) return;

    this.logger.warn(`الطابور مش متاح للطلب ${event.orderId} — بننفّذ التوزيع مباشرة.`);
    try {
      await this.matchingService.dispatchOrAutoConfirm(event.orderId);
    } catch (err) {
      this.logger.error(`فشل توزيع الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
