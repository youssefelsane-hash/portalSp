import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_CONTACT, LEGAL_ENTITY_AR, LEGAL_ENTITY_EN } from '@/lib/legal-content';

/**
 * صفحة حذف الحساب (docs/23 §P0-1) — **متطلَّب صريح من Google Play**: لازم يبقى فيه مسار حذف
 * جوّه التطبيق **ورابط ويب عام** يوصله أي حد من غير تسجيل دخول، وبيوضّح إيه اللي بيتحذف وإيه
 * اللي بيتحفظ وليه وكام مدة.
 *
 * الصفحة دي **عامة عمدًا** (مفيش أي فحص جلسة) — لو طلبت تسجيل دخول عشان تُقرأ، ما بتحققش
 * المتطلَّب أصلاً.
 */
export const metadata: Metadata = {
  title: 'حذف الحساب — أسطى',
  description: 'كيفية حذف حسابك على منصة أسطى (OSTA)، وما الذي يُحذف وما الذي يُحتفظ به ولماذا.',
};

const DELETED_DATA = [
  'الاسم وصورة الحساب والبريد الإلكتروني.',
  'رقم الهاتف — يُستبدل بقيمة بديلة لا يمكن الرجوع منها إليك، ولا يمكن استخدامه لتسجيل الدخول بعدها.',
  'العناوين المحفوظة وتفاصيل الوصول إليها.',
  'مستندات الهوية والمستندات المهنية المرفوعة (لمقدمي الخدمات).',
  'وسائل الدفع المحفوظة والأجهزة المسجَّلة للإشعارات.',
];

const RETAINED_DATA = [
  {
    title: 'سجلات الطلبات والمعاملات المالية',
    reason:
      'يفرض القانون الاحتفاظ بالسجلات المحاسبية والضريبية لمدة محددة، كما أنها ضرورية لتسوية مستحقات الأطراف الأخرى في الطلب. تُحفظ هذه السجلات بعد إزالة بياناتك الشخصية منها.',
  },
  {
    title: 'سجل المحفظة المالي',
    reason:
      'دفتر القيود المالي غير قابل للتعديل أو الحذف بحكم تصميمه، لأن أي تغيير فيه يفسد الحسابات المرتبطة بأطراف أخرى. يُحتفظ به بهوية مُخفاة.',
  },
  {
    title: 'الشكاوى والنزاعات القائمة',
    reason: 'إذا كان هناك نزاع أو مطالبة ضمان أو إجراء قانوني قائم، يُحتفظ بالبيانات اللازمة له حتى انتهائه.',
  },
];

export default function AccountDeletionPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-2xl font-bold sm:text-3xl">حذف حسابك على أسطى</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          منصة أسطى (OSTA) — الجهة المشغّلة: {LEGAL_ENTITY_AR} — <span dir="ltr">{LEGAL_ENTITY_EN}</span>
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">١. من داخل التطبيق</h2>
        <p className="mb-3 leading-8 text-foreground/90">
          افتح تطبيق أسطى (تطبيق العميل أو تطبيق الفني) ← <span className="font-semibold">حسابي</span> ←{' '}
          <span className="font-semibold">إعدادات الحساب</span> ← <span className="font-semibold">حذف الحساب</span>، ثم أكّد الطلب.
        </p>
        <p className="leading-8 text-foreground/90">
          تسري إجراءات الحذف فور التأكيد، وتُغلق جميع جلساتك على كل الأجهزة مباشرةً.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">٢. بدون التطبيق</h2>
        <p className="leading-8 text-foreground/90">
          إذا تعذّر عليك الدخول إلى التطبيق، أرسل طلب الحذف من البريد الإلكتروني أو رقم الهاتف المسجَّل على حسابك إلى قنوات
          الدعم الرسمية أدناه، مع ذكر رقم الهاتف المسجَّل. نتحقق من ملكيتك للحساب قبل التنفيذ، ونردّ خلال مدة معقولة.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">٣. ما الذي يُحذف</h2>
        <ul className="list-disc space-y-2 ps-6 leading-8 text-foreground/90">
          {DELETED_DATA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">٤. ما الذي يُحتفظ به ولماذا</h2>
        <p className="mb-4 leading-8 text-foreground/90">
          لا يمكن حذف بعض السجلات فورًا لأسباب قانونية أو مالية. تُحفظ هذه السجلات{' '}
          <span className="font-semibold">بعد فصلها عن هويتك الشخصية</span>، ولا تُستخدم للتواصل معك أو لأي غرض تسويقي.
        </p>
        <ul className="space-y-4">
          {RETAINED_DATA.map((item) => (
            <li key={item.title} className="rounded-lg border p-4">
              <h3 className="mb-1 font-semibold">{item.title}</h3>
              <p className="text-sm leading-7 text-muted-foreground">{item.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">٥. قبل الحذف</h2>
        <p className="mb-3 leading-8 text-foreground/90">
          لا يمكن إتمام الحذف إذا كان لديك <span className="font-semibold">رصيد في المحفظة</span> أو{' '}
          <span className="font-semibold">طلب نشط لم ينتهِ بعد</span>. استخدم الرصيد أو تواصل مع الدعم لاسترداده، وانتظر
          انتهاء الطلب القائم، ثم أعد المحاولة.
        </p>
        <p className="leading-8 text-foreground/90">حذف الحساب نهائي — لا يمكن استرجاع الحساب أو سجلّ طلباتك بعده.</p>
      </section>

      <section className="rounded-lg border bg-muted/30 p-5">
        <h2 className="mb-2 text-lg font-bold">قنوات الدعم الرسمية</h2>
        {LEGAL_CONTACT.supportEmail ? (
          <p className="mb-1 text-sm">
            البريد:{' '}
            <a className="underline" href={`mailto:${LEGAL_CONTACT.supportEmail}`} dir="ltr">
              {LEGAL_CONTACT.supportEmail}
            </a>
          </p>
        ) : null}
        {LEGAL_CONTACT.supportPhone ? (
          <p className="text-sm">
            الهاتف: <span dir="ltr">{LEGAL_CONTACT.supportPhone}</span>
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          للمزيد عن كيفية تعاملنا مع بياناتك، راجع{' '}
          <Link className="underline" href="/legal/privacy">
            سياسة الخصوصية
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
