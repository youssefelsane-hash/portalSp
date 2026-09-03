// كل الأسعار في الباك-إند بالقرش (integer) — docs/01-master-plan.md §1.4
// نستخدم أرقام لاتينية (nu-latn) عمداً — أرقام ar-EG الافتراضية (هندية عربية ٠١٢٣) مش
// مقروءة بسهولة لمبالغ مالية في لوحة تحكم، والنمط الشائع في تطبيقات مصرية مشابهة إنجليزي.
export function formatEgp(cents: number): string {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'currency', currency: 'EGP' }).format(cents / 100);
}

/**
 * مدة بالثواني → نص عربي مختصر. **الثواني بتيجي محسوبة من الباك-إند بوقت الخادم** — الواجهة
 * بتنسّق بس. ده مقصود: ساعة المتصفح ممكن تكون غلط بدقايق، والفرق ده كفاية يخلي «متأخر 30 ثانية»
 * تبان «مش متأخر» في شاشة والعكس في شاشة تانية.
 */
export function formatDurationAr(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} ثانية`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} ساعة و${restMinutes} دقيقة` : `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} يوم و${restHours} ساعة` : `${days} يوم`;
}
