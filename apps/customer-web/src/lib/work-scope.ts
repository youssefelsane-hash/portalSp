/**
 * صياغة «حجم الشغلانة» زي ما العميل بيقراها — نسخة الويب من
 * `apps/customer-app/lib/core/work_scope_label.dart` **بنفس القواعد بالحرف**.
 *
 * البَقّة اللي بتتقفل هنا (بلاغ مالك 2026-09-04): شغلانة ساعتين كانت بتتعرض «يوم واحد» في
 * تطبيق العميل، وفي الويب المدة مكانتش بتتعرض خالص رغم إن `duration_minutes` راجعة في
 * `POST /orders/preview` من الأول. الاتنين نفس السبب: الواجهة مش بتقرا الحقل الأدق.
 *
 * القاعدة: الدقايق بتكسب لما تكون موجودة، والأيام للشغل اللي فعلاً بيمتد على أيام.
 */

/** نص المدة، أو `null` لو مفيش تقدير — الواجهة ساعتها ما تعرضش السطر أصلاً. */
export function formatWorkDuration(minutes: number | null, days: number | null): string | null {
  if (minutes != null && minutes > 0) {
    // شغل ممتد على أيام بيتكتب بالأيام حتى لو الدقايق موجودة — «٢٨٨٠ دقيقة» مش معلومة مفيدة.
    if (days != null && days >= 1 && minutes >= 24 * 60) return daysLabel(days);
    return minutesLabel(minutes);
  }
  if (days != null && days > 0) return daysLabel(days);
  return null;
}

/**
 * «١ متخصص» / «٢ متخصصين» + المساعدين لو فيه.
 *
 * كلمة «صنايعي» اتشالت بطلب المالك: المنصة فيها خدمات مش حرفية (جليسة أطفال، تنظيف، رعاية).
 */
export function formatWorkforce(technicians: number | null, assistants: number | null): string | null {
  const parts: string[] = [];
  if (technicians != null && technicians > 0) parts.push(countLabel(technicians, 'متخصص', 'متخصصين'));
  if (assistants != null && assistants > 0) parts.push(countLabel(assistants, 'مساعد', 'مساعدين'));
  return parts.length === 0 ? null : parts.join(' + ');
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return countLabel(minutes, 'دقيقة', 'دقايق');
  const rest = minutes % 60;
  if (rest === 0) return countLabel(Math.floor(minutes / 60), 'ساعة', 'ساعات');
  // «ساعة ونص» أوضح بكتير من «١.٥ ساعة» في الاستخدام اليومي.
  if (rest === 30) return `${countLabel(Math.floor(minutes / 60), 'ساعة', 'ساعات')} ونص`;
  return `${(minutes / 60).toFixed(1)} ساعة`;
}

function daysLabel(days: number): string {
  if (Number.isInteger(days)) return countLabel(days, 'يوم', 'أيام');
  return `${days.toFixed(1)} يوم`;
}

/** تصريف عربي مبسّط بس صحيح: ١ مفرد، ٢ مثنى، ٣–١٠ جمع، ١١+ تمييز مفرد. */
function countLabel(count: number, singular: string, plural: string): string {
  if (count === 1) return `${singular} واحد`;
  if (count === 2) return dual(singular);
  if (count <= 10) return `${count} ${plural}`;
  return `${count} ${singular}`;
}

function dual(singular: string): string {
  return singular.endsWith('ة') ? `${singular.slice(0, -1)}تين` : `${singular}ين`;
}
