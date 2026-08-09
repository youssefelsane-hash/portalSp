export const REFERRAL_REGISTERED_EVENT = 'referral.registered';

// بيتصدر من AuthService.register() لما مستخدم جديد يسجّل بكود ترشيح صحيح — auth بيتحكم في
// users بس (حدود الموديولات)، إنشاء صف referrals مسؤولية موديول referrals لما يستقبل الحدث ده.
export class ReferralRegisteredEvent {
  constructor(
    public readonly referrerUserId: string,
    public readonly referredUserId: string,
  ) {}
}
