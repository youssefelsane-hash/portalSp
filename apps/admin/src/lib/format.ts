// كل الأسعار في الباك-إند بالقرش (integer) — docs/01-master-plan.md §1.4
// نستخدم أرقام لاتينية (nu-latn) عمداً — أرقام ar-EG الافتراضية (هندية عربية ٠١٢٣) مش
// مقروءة بسهولة لمبالغ مالية في لوحة تحكم، والنمط الشائع في تطبيقات مصرية مشابهة إنجليزي.
export function formatEgp(cents: number): string {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'currency', currency: 'EGP' }).format(cents / 100);
}
