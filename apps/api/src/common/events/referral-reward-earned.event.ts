export const REFERRAL_REWARD_EARNED_EVENT = 'referral.reward_earned';

// بيتصدر من ReferralsService لما مُرشِّح يوصل لمضاعف جديد من referral.required_referrals_per_reward
// — notifications بتشترك فيه عشان تبعت الإشعار، مش referrals بيعرف تفاصيل قنوات الإشعار.
export class ReferralRewardEarnedEvent {
  constructor(
    public readonly referrerUserId: string,
    public readonly promoCode: string,
    public readonly rewardValueEgp: number,
    public readonly completedReferralsCount: number,
  ) {}
}
