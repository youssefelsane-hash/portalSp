import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { REFERRAL_REWARD_EARNED_EVENT, ReferralRewardEarnedEvent } from '../../../common/events/referral-reward-earned.event';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class ReferralRewardNotificationListener {
  private readonly logger = new Logger(ReferralRewardNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(REFERRAL_REWARD_EARNED_EVENT)
  async handle(event: ReferralRewardEarnedEvent): Promise<void> {
    try {
      await this.notificationsService.notify({
        userId: event.referrerUserId,
        notificationType: 'referral_reward_earned',
        titleAr: 'مبروك! كسبت مكافأة ترشيح 🎉',
        bodyAr: `وصلت لـ ${event.completedReferralsCount} ترشيحات ناجحة — استخدم كود "${event.promoCode}" واخصم ${event.rewardValueEgp} جنيه من طلبك الجاي.`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار مكافأة الترشيح للمستخدم ${event.referrerUserId}`, err instanceof Error ? err.stack : err);
    }
  }
}
