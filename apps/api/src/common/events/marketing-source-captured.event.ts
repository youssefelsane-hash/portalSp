export const MARKETING_SOURCE_CAPTURED_EVENT = 'marketing_source.captured';

/**
 * بيتصدر من `AuthService.register()` لما مستخدم جديد يسجّل ومعاه كود مصدر تسويق (ADR-0082 §3).
 *
 * `auth` بيتحكم في `users` بس (حدود الموديولات) — إنشاء صف الإسناد مسؤولية موديول `marketing`.
 * نفس نمط `TECHNICIAN_REFERRAL_CAPTURED_EVENT` بالحرف، عشان مايبقاش عندنا نمطين لنفس الحاجة.
 */
export class MarketingSourceCapturedEvent {
  constructor(
    public readonly userId: string,
    public readonly code: string,
  ) {}
}
