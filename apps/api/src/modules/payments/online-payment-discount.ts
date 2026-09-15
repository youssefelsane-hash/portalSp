import { SettingsService } from '../settings/settings.service';

/**
 * **خصم الدفع الإلكتروني** (ADR-0085، طلب مالك §141 بند ٥: «هدية الدفع أونلاين»).
 *
 * الملف ده هو **نقطة القرار الوحيدة**: اللي بيعرض الوسم للعميل (`GET /payment-channels`) واللي
 * بيخصم الفلوس فعليًا وقت إنشاء الطلب بيقروا من نفس الدالتين هنا. الفصل بينهم هو بالظبط اللي
 * بينتج «الواجهة بتقول خصم والفاتورة مافيهاش خصم» — وده أسوأ من إن الخصم مايكونش موجود أصلاً.
 */
export interface OnlineDiscountPolicy {
  enabled: boolean;
  amountCents: number;
  minOrderCents: number;
  /** أسماء وسائل الدفع المؤهّلة، متطبّعة (lowercase, trimmed). */
  methods: Set<string>;
  labelTemplateAr: string;
}

/** القيم الافتراضية مكرّرة هنا عمدًا عشان الدالة تفضل شغّالة لو الإعداد اتمسح من الجدول. */
export async function loadOnlineDiscountPolicy(settings: SettingsService): Promise<OnlineDiscountPolicy> {
  const [enabled, amountCents, minOrderCents, methodsRaw, labelTemplateAr] = await Promise.all([
    settings.getBoolean('payments.online_discount_enabled', false),
    settings.getNumber('payments.online_discount_cents', 3000),
    settings.getNumber('payments.online_discount_min_order_cents', 0),
    settings.getString('payments.online_discount_methods', 'instapay,card'),
    settings.getString('payments.online_discount_label_ar', 'وفّر {discount} ج.م لما تدفع دلوقتي'),
  ]);

  return {
    enabled,
    // الأرقام السالبة مرفوضة هنا مش وقت الحفظ: إعداد غلط لازم يخلّي الخصم **صفر**، مش يزوّد
    // الفاتورة على العميل.
    amountCents: Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0,
    minOrderCents: Number.isFinite(minOrderCents) && minOrderCents > 0 ? Math.floor(minOrderCents) : 0,
    methods: new Set(
      (methodsRaw ?? '')
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean),
    ),
    labelTemplateAr: labelTemplateAr ?? '',
  };
}

/**
 * الخصم المستحق فعليًا لوسيلة دفع وإجمالي معيّنين — **صفر** لو الشرط مش متحقق.
 *
 * السقف عند `totalBeforeDiscountCents` مش تجميل: إعداد خصم أكبر من الطلب نفسه كان هيطلّع إجمالي
 * سالب، والأسعار كلها `integer` بالقرش (مفيش float يمتص الغلط).
 */
export function resolveOnlineDiscountCents(
  policy: OnlineDiscountPolicy,
  paymentMethod: string | null | undefined,
  totalBeforeDiscountCents: number,
): number {
  if (!policy.enabled || policy.amountCents <= 0) return 0;
  if (!paymentMethod || !policy.methods.has(paymentMethod.trim().toLowerCase())) return 0;
  if (totalBeforeDiscountCents < policy.minOrderCents) return 0;
  return Math.min(policy.amountCents, Math.max(totalBeforeDiscountCents, 0));
}

/** نص الوسم بعد تبديل `{discount}` بالجنيه — فاضي لو مفيش خصم أو مفيش قالب. */
export function onlineDiscountLabelAr(policy: OnlineDiscountPolicy, discountCents: number): string | null {
  if (discountCents <= 0 || !policy.labelTemplateAr.trim()) return null;
  // القسمة على ١٠٠ بتتعرض بلا كسور لما المبلغ جنيهات صحيحة (٣٠ مش ٣٠٫٠٠).
  const egp = discountCents / 100;
  const formatted = Number.isInteger(egp) ? String(egp) : egp.toFixed(2);
  return policy.labelTemplateAr.replaceAll('{discount}', formatted);
}
