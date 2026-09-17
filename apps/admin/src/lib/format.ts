// كل الأسعار في الباك-إند بالقرش (integer) — docs/01-master-plan.md §1.4
// نستخدم أرقام لاتينية (nu-latn) عمداً — أرقام ar-EG الافتراضية (هندية عربية ٠١٢٣) مش
// مقروءة بسهولة لمبالغ مالية في لوحة تحكم، والنمط الشائع في تطبيقات مصرية مشابهة إنجليزي.
export function formatEgp(cents: number): string {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'currency', currency: 'EGP' }).format(cents / 100);
}

/**
 * **الوقت النسبي للموعد** (docs/08 §157) — «بعد ساعتين» / «متأخر ٣٥ دقيقة».
 *
 * طلب المالك: «ويبقى موعد التنفيذ واضح جدًا، وتحت منه لو مناسب: بعد ساعتين أو متأخر ٣٥ دقيقة…
 * وده أفيد للأدمن بكتير من مجرد تاريخ».
 *
 * `null` لو مفيش موعد — الواجهة ساعتها ما تعرضش السطر أصلاً.
 */
export function formatRelativeSchedule(scheduledAt: string | null, now: Date = new Date()): string | null {
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return null;
  const diffMinutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  const late = diffMinutes < 0;
  const abs = Math.abs(diffMinutes);
  // أقل من دقيقة في أي اتجاه = «دلوقتي». «متأخر ٠ دقيقة» رقم بلا معنى.
  if (abs < 1) return 'دلوقتي';
  const unit =
    abs < 60
      ? `${abs} دقيقة`
      : abs < 60 * 24
        ? `${Math.round(abs / 60)} ساعة`
        : `${Math.round(abs / (60 * 24))} يوم`;
  return late ? `متأخر ${unit}` : `بعد ${unit}`;
}

/** نافذة التنفيذ «15:00 → 17:00» لما المدة معروفة — أفيد للأدمن من ساعة البداية وحدها. */
export function formatExecutionWindow(scheduledAt: string | null, durationMinutes: number | null): string | null {
  if (!scheduledAt || durationMinutes === null || durationMinutes <= 0) return null;
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) return null;
  // شغل ممتد على أيام نافذته مش ساعة-لساعة — الصياغة دي بتضلّل هناك، فبنسكت.
  if (durationMinutes >= 24 * 60) return null;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const hhmm = (d: Date) =>
    d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${hhmm(start)} → ${hhmm(end)}`;
}
