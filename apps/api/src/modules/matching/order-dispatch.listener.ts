import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { DEFERRED_DISPATCH_JOB, DeferredDispatchJobData, MATCHING_DISPATCH_QUEUE, deferredDispatchJobId } from './matching-dispatch.queue';
import { MatchingService } from './matching.service';

@Injectable()
export class OrderDispatchListener {
  private readonly logger = new Logger(OrderDispatchListener.name);

  constructor(
    private readonly matchingService: MatchingService,
    @InjectQueue(MATCHING_DISPATCH_QUEUE) private readonly dispatchQueue: Queue<DeferredDispatchJobData>,
  ) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      // ADR-0009 بند 1-2 (P0-9) — طلب مجدول "بعيد" (dispatchDeferredUntil محسوبة في
      // OrdersService.create()): بدل ما نبث فورًا، نجدول job مؤجّل يبدأ أول جولة مطابقة حقيقية
      // قرب الموعد. jobId ثابت (deferredDispatchJobId(orderId)) يمنع أي تكرار لو الحدث اتنادى
      // مرتين بالغلط لنفس الطلب.
      if (event.dispatchDeferredUntil && event.dispatchDeferredUntil.getTime() > Date.now()) {
        const delay = event.dispatchDeferredUntil.getTime() - Date.now();
        await this.dispatchQueue.add(
          DEFERRED_DISPATCH_JOB,
          { orderId: event.orderId },
          { delay, jobId: deferredDispatchJobId(event.orderId) },
        );
        this.logger.log(`بث الطلب ${event.orderId} اتأجّل لحد ${event.dispatchDeferredUntil.toISOString()}`);
        return;
      }

      await this.matchingService.dispatchNextRound(event.orderId);
    } catch (err) {
      this.logger.error(`فشل توزيع الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
