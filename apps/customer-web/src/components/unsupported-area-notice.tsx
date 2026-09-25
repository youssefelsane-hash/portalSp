import Link from 'next/link';

/**
 * **منطقة مش مخدومة** (طلب مالك 2026-09-25، بند «حالات الأخطاء»).
 *
 * الحالة دي كانت موجودة بس **بلا مخرج**: سطر أحمر بيقول «أضف عنوانًا داخل منطقة خدمة» والمستخدم
 * واقف مكانه — الصفحة اللي بيضيف فيها العنوان مش مذكورة ومش مربوطة. نص من غير خطوة تالية بيتقرا
 * كرفض مش كإرشاد.
 *
 * ونص واحد في مكان واحد: الرسالة كانت مكتوبة بالحرف مرتين (الرئيسية والبحث)، وأول تعديل على
 * واحدة كان هيخلّي الصفحتين يقولوا كلام مختلف لنفس الحالة.
 */
export function UnsupportedAreaNotice({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-5 text-center ${className}`}
      data-testid="unsupported-area-notice"
    >
      <p className="text-sm font-semibold">لسه مش بنخدم المنطقة دي</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        عنوانك الحالي بره نطاق التغطية، فمش بنعرض خدمات مش هنقدر نوصلها. لو عندك عنوان تاني جوّه
        الإسكندرية، أضفه وهتشوف الخدمات المتاحة عليه فورًا.
      </p>
      <Link
        href="/account/addresses"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.99]"
        data-testid="unsupported-area-action"
      >
        إدارة عناويني
      </Link>
    </div>
  );
}
