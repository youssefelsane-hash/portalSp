import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderSourceChannel } from '../orders/entities/order.entity';
import {
  BookingFunnelEvent,
  FunnelEventOutcome,
  FunnelEventSource,
  FunnelStage,
} from './entities/booking-funnel-event.entity';

export interface TrackFunnelEventInput {
  stage: FunnelStage;
  source: FunnelEventSource;
  funnelSessionId?: string | null;
  userId?: string | null;
  serviceId?: string | null;
  cityId?: string | null;
  clientChannel?: OrderSourceChannel;
  orderId?: string | null;
  outcome?: FunnelEventOutcome;
  failureReason?: string | null;
}

/** أطول من عمود `failure_reason` بحرف واحد كان هيرمي على مستوى القاعدة ويضيّع الحدث كله. */
const FAILURE_REASON_MAX = 120;

/**
 * نقطة الكتابة **الوحيدة** لسجل رحلة الحجز (ADR-0075 §3).
 *
 * القاعدة الحاكمة هنا مكتوبة في `track()` نفسها: **الفشل في تسجيل إحصائية مايكسرش حجز أبدًا.**
 * أسوأ نتيجة ممكنة من الملف ده هي رقم ناقص في تقرير — مش طلب اتعطّل على عميل. نفس فلسفة
 * `campaigns` بالحرف (CLAUDE.md قاعدة ٢: أي فشل بنية تحتية يتلقّط ويتعامل معاه بأمان).
 */
@Injectable()
export class FunnelTrackerService {
  private readonly logger = new Logger(FunnelTrackerService.name);

  constructor(
    @InjectRepository(BookingFunnelEvent)
    private readonly events: Repository<BookingFunnelEvent>,
  ) {}

  async track(input: TrackFunnelEventInput): Promise<void> {
    try {
      const outcome = input.outcome ?? 'success';
      // القيد في القاعدة بيرفض «فشل بلا سبب» و«نجاح بسبب فشل» — بنطبّع هنا بدل ما نسيب
      // الاستثناء يحصل ويضيّع الحدث.
      const failureReason =
        outcome === 'failed' ? (input.failureReason ?? 'unknown').slice(0, FAILURE_REASON_MAX) : null;

      await this.events.insert({
        stage: input.stage,
        source: input.source,
        outcome,
        failureReason,
        funnelSessionId: input.funnelSessionId ?? null,
        userId: input.userId ?? null,
        serviceId: input.serviceId ?? null,
        cityId: input.cityId ?? null,
        clientChannel: input.clientChannel ?? OrderSourceChannel.CUSTOMER_APP,
        orderId: input.orderId ?? null,
        occurredAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `فشل تسجيل حدث الفنل ${input.stage} (${input.source}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * غلاف fire-and-forget للمسارات اللي مايستنوش الكتابة (نداء API بيرجّع للعميل).
   * `void` مقصود ومعلَن — `no-floating-promises` بيمنع الشكل ده من غير الغلاف ده، وهي القاعدة
   * اللي اتحطت بعد بَقّة حقيقية علّقت طلب وقت انقطاع Redis.
   */
  trackDetached(input: TrackFunnelEventInput): void {
    void this.track(input);
  }
}
