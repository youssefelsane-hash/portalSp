/**
 * **تمرير هادي للخطوة الجاية** (docs/08 §189 بند UX-3) — نفس سلوك
 * `apps/customer-app/lib/design/reveal_next_section.dart`.
 *
 * بعد ما العميل يختار اليوم، الساعة بتظهر تحت الشاشة وهو مايعرفش إنها موجودة. هنا بننزل **أقل مسافة**
 * تبيّن الجزء الجاي — مش بنرمي الصفحة لأولها ولا بنقفل على المستخدم: لو الجزء باين أصلاً مفيش حركة،
 * ولو الجزء أطول من الشاشة بنوقف عند أوله عشان اللي اختاره لسه يفضل قريب.
 */

/** مسافة بتتساب تحت الجزء عشان مايبقاش لازق في حافة الشاشة. */
const BOTTOM_BREATHING_PX = 24;

/**
 * كام بكسل ننزل (0 = مفيش حركة). `topInset` = اللي مغطّي أعلى الشاشة (الهيدر الثابت).
 * الحساب منفصل عن الـDOM عشان يتختبر من غير متصفح.
 */
export function revealScrollDelta(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  topInset = 0,
): number {
  const needed = rect.bottom + BOTTOM_BREATHING_PX - viewportHeight;
  if (needed <= 0) return 0;
  // ماينزلش لدرجة إن أول الجزء يستخبى ورا الهيدر.
  const cap = rect.top - topInset;
  return Math.max(0, Math.min(needed, cap));
}

/** بعد الرسم الجاي (الجزء ممكن يكون لسه اتعرض/اتمد بالاقتراحات). بيحترم «تقليل الحركة». */
export function revealNextSection(element: HTMLElement | null, topInset = 96): void {
  if (!element || typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    if (!element.isConnected) return;
    const delta = revealScrollDelta(element.getBoundingClientRect(), window.innerHeight, topInset);
    if (delta <= 0) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.scrollBy({ top: delta, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
}
