export const TECHNICIAN_REFERRAL_CAPTURED_EVENT = 'technician_referral.captured';

// بيتصدر من AuthService.register() لما عميل جديد يسجّل بكود ترشيح فني صحيح (QR/deep link) —
// auth بيتحكم في users بس (حدود الموديولات)، إنشاء صف الالتقاط مسؤولية موديول technician-referrals.
export class TechnicianReferralCapturedEvent {
  constructor(
    public readonly customerUserId: string,
    public readonly referralToken: string,
  ) {}
}
