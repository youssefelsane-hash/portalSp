import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PROMO_LINK_CAPTURED_EVENT, PromoLinkCapturedEvent } from '../../../common/events/promo-link-captured.event';
import { PromoCodeLinksService } from '../promo-code-links.service';

/** التسجيل ينجح حتى لو قياس رابط الخصم تعذر؛ الإسناد إحصائي ثانوي. */
@Injectable()
export class PromoLinkCapturedListener {
  private readonly logger = new Logger(PromoLinkCapturedListener.name);

  constructor(private readonly links: PromoCodeLinksService) {}

  @OnEvent(PROMO_LINK_CAPTURED_EVENT)
  async handle(event: PromoLinkCapturedEvent): Promise<void> {
    try {
      await this.links.attributeUser(event.userId, event.code);
    } catch (err) {
      this.logger.warn(`فشل إسناد التسجيل لرابط كود الخصم: ${err instanceof Error ? err.message : err}`);
    }
  }
}
