export const PROMO_LINK_CAPTURED_EVENT = 'promo_link.captured';

/** يصدر بعد نجاح التسجيل؛ موديول العروض هو الوحيد الذي يكتب إسناد رابط كود الخصم. */
export class PromoLinkCapturedEvent {
  constructor(
    public readonly userId: string,
    public readonly code: string,
  ) {}
}
