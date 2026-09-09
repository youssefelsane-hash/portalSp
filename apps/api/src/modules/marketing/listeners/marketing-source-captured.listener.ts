import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MARKETING_SOURCE_CAPTURED_EVENT,
  MarketingSourceCapturedEvent,
} from '../../../common/events/marketing-source-captured.event';
import { MarketingService } from '../marketing.service';

/**
 * ربط المستخدم الجديد بمصدر التسويق اللي جابه (ADR-0082 §3).
 *
 * **مايرميش أبدًا**: كود غلط أو حملة موقوفة أو مستخدم مُسنَد قبل كده = تجاهل بهدوء. الحساب
 * اتعمل فعلاً والتسجيل خلص؛ فشل الإسناد إحصائية ضايعة مش عطل في تجربة المستخدم.
 */
@Injectable()
export class MarketingSourceCapturedListener {
  private readonly logger = new Logger(MarketingSourceCapturedListener.name);

  constructor(private readonly marketing: MarketingService) {}

  @OnEvent(MARKETING_SOURCE_CAPTURED_EVENT)
  async handle(event: MarketingSourceCapturedEvent): Promise<void> {
    try {
      await this.marketing.attributeUser(event.userId, event.code);
    } catch (err) {
      this.logger.warn(
        `فشل إسناد المستخدم ${event.userId} لمصدر التسويق: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
