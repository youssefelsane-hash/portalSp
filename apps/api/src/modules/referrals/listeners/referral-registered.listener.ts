import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { REFERRAL_REGISTERED_EVENT, ReferralRegisteredEvent } from '../../../common/events/referral-registered.event';
import { ReferralsService } from '../referrals.service';

@Injectable()
export class ReferralRegisteredListener {
  private readonly logger = new Logger(ReferralRegisteredListener.name);

  constructor(private readonly referralsService: ReferralsService) {}

  @OnEvent(REFERRAL_REGISTERED_EVENT)
  async handle(event: ReferralRegisteredEvent): Promise<void> {
    try {
      await this.referralsService.createPendingReferral(event.referrerUserId, event.referredUserId);
    } catch (err) {
      this.logger.error(
        `فشل إنشاء صف ترشيح معلّق (referrer=${event.referrerUserId}, referred=${event.referredUserId})`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
