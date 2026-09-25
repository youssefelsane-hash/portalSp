// نفس تعريف `account.ts` بالحرف — الملفين دول طبقة بيانات محلية مش عقد مشترك.
type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * **إشارات اهتمام العميل** (ADR-0046 §5) — الغذاء اللي محرك «الحجز المتروك» شغّال عليه.
 *
 * `CampaignsService.sweepAbandonedIntents` بيقرا من `customer_service_intents` عشان يفكّر
 * العميل اللي بصّ على خدمة وما كمّلش. تطبيق العميل بيبعت الإشارة دي من زمان
 * (`catalog_navigation.dart`)، والموقع **مكانش بيبعتها خالص** — يعني كل زائر بيبدأ حجز من
 * الويب ويسيبه كان بيضيع من المحرك بالكامل.
 */

export type IntentStage = 'viewed_service' | 'started_booking';

/**
 * **fire-and-forget بالكامل**: بلا `await` في مسار المستخدم وبلا أي رمي للأخطاء.
 *
 * تعطيل حجز حقيقي لأن إشارة تسويقية ما اتسجلتش مقايضة غبية — نفس القرار الحرفي المكتوب في
 * `catalog_navigation.dart` في التطبيق.
 *
 * والزائر اللي مش مسجّل دخول مابيتبعتش له حاجة: مفيش حساب نبعتله إشعار أصلاً، والمسار محمي
 * بتوكن فالنداء كان هيرجع 401 على الفاضي.
 */
export function recordServiceIntent(
  authedFetch: AuthedFetch,
  isAuthenticated: boolean,
  serviceId: string,
  stage: IntentStage = 'started_booking',
): void {
  if (!isAuthenticated || !serviceId) return;
  void authedFetch('/customer/service-intents', {
    method: 'POST',
    body: JSON.stringify({ service_id: serviceId, intent_stage: stage }),
  }).catch(() => {
    // مقصود: الإشارة دي مالهاش أي أثر على الحجز نفسه.
  });
}

export interface MarketingPreference {
  marketing_opt_out: boolean;
}

export async function fetchMarketingPreference(authedFetch: AuthedFetch): Promise<MarketingPreference> {
  return authedFetch<MarketingPreference>('/customer/marketing-preference');
}

/**
 * إلغاء/تفعيل الاشتراك التسويقي — **مستقل تمامًا** عن قنوات إشعارات الطلبات (ADR-0046 §6):
 * العميل يقفل الإعلانات من غير ما يفقد «الفني في الطريق».
 */
export async function setMarketingOptOut(
  authedFetch: AuthedFetch,
  optOut: boolean,
): Promise<MarketingPreference> {
  return authedFetch<MarketingPreference>('/customer/marketing-preference', {
    method: 'PATCH',
    body: JSON.stringify({ marketing_opt_out: optOut }),
  });
}
