import { TechnicianBookingListItem } from './technicians.service';

/**
 * **سقف قرار المستوى كشرط إتاحة في قايمة اختيار المنفّذ** (ADR-0118، docs/08 §196).
 *
 * المحرك (`findEligibleTechnicians`) والتأكيد (`assertEligible`) بيرفضوا أي منفّذ إجمالي الطلب
 * أكبر من `decision_limit_cents` بتاع مستواه. القايمة ماكانتش بتطبّق الشرط ده، فكانت بتعرض «جديد»
 * (سقف ٢٠٠ج) متاح على شغلانة ٦٢٤ج — والعميل يختاره فيترفض، أو يدوس «خلي أسطى يختار» فيقوله
 * «مفيش حد» والقايمة قدامه فيها أربعة.
 *
 * الشرط بيتطبّق **بعد** التسعير لأن السعر بيختلف بمستوى/فئة كل منفّذ، والمقارنة لازم تبقى بسعره هو
 * — نفس الرقم اللي `final_price_cents` بيعرضه واللي المعاينة بتسعّر بيه.
 *
 *  - `showUnavailable` (إعداد الخدمة، ADR-0030) و`includeIneligible` (العميل بيفهم الحالة الجديدة):
 *    الاتنين ⇒ الصف بيفضل ظاهر أحمر بسببه. غير كده بيتشال. التطبيق المنشور بيقرا أي حالة غير
 *    `schedule_conflicted` كـ«متاح»، فبعتله حالة جديدة كان هيرجّع نفس البَقّة — فبيتشال له.
 *  - السعر مش معروف (خدمة formula فورمها ناقص) ⇒ مفيش أساس للمقارنة، والصف بيفضل زي ما هو. المعاينة
 *    نفسها مابتسعّرش من غير الفورم، فمفيش تناقض.
 *  - المتاحين الأول بنفس ترتيبهم، وغير المتاحين آخر القايمة.
 */
export function applyDecisionLimitGate<T extends { item: TechnicianBookingListItem; amountCents: number | null }>(
  entries: T[],
  opts: { showUnavailable: boolean; includeIneligible: boolean },
): T[] {
  const kept: T[] = [];
  for (const entry of entries) {
    const { item, amountCents } = entry;
    const overCap =
      item.availabilityStatus === 'available' &&
      amountCents !== null &&
      item.decisionLimitCents !== null &&
      amountCents > item.decisionLimitCents;
    if (!overCap) {
      kept.push(entry);
      continue;
    }
    if (!(opts.showUnavailable && opts.includeIneligible)) continue;
    entry.item.availabilityStatus = 'not_eligible';
    entry.item.unavailableReasonAr = item.isCompany
      ? 'مفيش حد في الشركة متاح لشغلانة بالحجم ده دلوقتي'
      : 'الشغلانة دي أكبر من المسموح لمستواه الحالي';
    entry.item.availableAgainAt = null;
    kept.push(entry);
  }
  return [
    ...kept.filter((entry) => entry.item.availabilityStatus === 'available'),
    ...kept.filter((entry) => entry.item.availabilityStatus !== 'available'),
  ];
}
