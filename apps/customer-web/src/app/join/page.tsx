import type { Metadata } from 'next';
import Link from 'next/link';

import { fetchLegalEntity } from '@/lib/legal-content';
import { fetchSupportContactServer, fetchTrustInfo } from '@/lib/public-info';

export const metadata: Metadata = {
  title: 'انضم كمقدم خدمة — أسطى',
  description: 'اشتغل مع أسطى (OSTA) كفني أو مساعد أو فريق: الشروط، خطوات التسجيل، وطريقة التواصل.',
};

/**
 * «انضم كمقدم خدمة» (docs/08 §136 — البند الخامس في عمود OSTA بالفوتر).
 *
 * **ليه مفيش زرار «حمّل التطبيق» هنا؟** `marketing.android_store_url` و`marketing.ios_store_url`
 * لسه فاضيين لحد ما التطبيق ينزل المتاجر فعلاً، ومفيش endpoint عام بيرجّعهم. زرار بيودّي لرابط
 * فاضي هو بالظبط فئة البَقّة اللي الصفحة دي اتعملت عشانها (لينك `/support` المكسور في الفوتر)،
 * فالوجهة الوحيدة المعروضة هنا هي قنوات تواصل **موجودة ومفعّلة فعلاً**. أول ما الروابط تتسجّل
 * ويبقى فيه عقد عام ليها، يتزاد هنا قسم تحميل.
 *
 * كل الشروط والخطوات تحت بتوصف مسار الانضمام المنفَّذ فعلاً (تسجيل الفني → مراجعة الإدارة →
 * تفعيل → استقبال طلبات)، والضمان بيتقرا من نفس مصدر الضمان الحقيقي.
 */

const REQUIREMENTS: string[] = [
  'تكون متقن لصنعتك فعلاً — الشغل بيتقيّم من العميل بعد كل طلب، والتقييم بيأثر على الطلبات اللي بتوصلك.',
  'بطاقة رقم قومي سارية باسمك — بتتراجع من الإدارة قبل تفعيل الحساب.',
  'موبايل يشتغل عليه تطبيق أسطى للفنيين، وخط إنترنت.',
  'عدّتك الأساسية بتاعة صنعتك.',
  'شهادات أو خبرات موثّقة لو عندك — مش شرط، بس بترفع تصنيفك وبتزوّد الطلبات المتاحة لك.',
];

const STEPS: { title: string; body: string }[] = [
  {
    title: 'سجّل بياناتك',
    body: 'اسمك ورقمك وصنعتك والمناطق اللي تقدر تشتغل فيها، مع صور المستندات المطلوبة.',
  },
  {
    title: 'مراجعة من الإدارة',
    body: 'بنراجع بياناتك ومستنداتك. ممكن نكلّمك لو محتاجين توضيح، وبيوصلك إشعار بالنتيجة.',
  },
  {
    title: 'تفعيل الحساب وتحديد جدولك',
    body: 'بعد القبول بتحدد أيامك المتاحة والمناطق اللي تخدمها، والخدمات اللي مصرَّح لك بيها.',
  },
  {
    title: 'استقبل الطلبات واقبض',
    body: 'الطلبات المناسبة لصنعتك ومنطقتك وجدولك بتوصلك على التطبيق. أرباحك بتتجمّع في محفظتك وبتتصرف بطلب صرف.',
  },
];

export default async function JoinPage() {
  const [entity, support, trust] = await Promise.all([
    fetchLegalEntity(),
    fetchSupportContactServer(),
    fetchTrustInfo(),
  ]);

  const supportEnabled = Boolean(support?.enabled);
  const whatsappUrl = supportEnabled ? support?.whatsapp_url : null;
  const phone = supportEnabled ? support?.phone_number : null;
  const email = entity.support_email ?? (supportEnabled ? support?.email : null) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <header>
        <p className="text-sm font-medium text-primary">انضم كمقدم خدمة</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
          اشتغل مع {entity.platform_name_ar} — شغل بيوصلك، وسعر متفق عليه
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          سواء إنت فني مستقل، أو معاك مساعد، أو عندك فريق أو شركة صيانة — تقدر تتسجّل على{' '}
          {entity.platform_name_ar} وتستقبل طلبات من عملاء في منطقتك، بمواعيد إنت اللي بتحددها.
        </p>
      </header>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { title: 'شغل مستمر', body: 'الطلبات بتتوزّع حسب صنعتك ومنطقتك وجدولك — من غير ما تدوّر على شغل بنفسك.' },
          { title: 'سعر واضح قبل ما تبدأ', body: 'السعر بيتحسب من الخدمة ومستواك، والعميل موافق عليه قبل ما تروح.' },
          { title: 'فلوسك محفوظة', body: 'كل طلب بيتسجّل في محفظتك بأرباحه، وتقدر تطلب صرف مستحقاتك في أي وقت.' },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold">{card.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{card.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold">إيه المطلوب منك</h2>
        <ul className="mt-5 space-y-3">
          {REQUIREMENTS.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold">خطوات الانضمام</h2>
        <ol className="mt-6 space-y-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-border bg-surface p-5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* التزام الضمان بيتقال بالمدة النافذة فعلاً — مقدّم الخدمة لازم يعرفه قبل ما يتسجّل، مش
          بعد أول إعادة زيارة. */}
      {trust && (
        <section className="mt-12 rounded-2xl border border-border bg-surface-variant/50 p-5">
          <h2 className="font-semibold">حاجة مهمة تعرفها قبل ما تبدأ</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            الشغل اللي بتنفّذه عليه ضمان {trust.warranty_label_ar} تجاه العميل. لو ظهرت مشكلة في
            نفس الشغل خلال المدة دي، إعادة الزيارة بتبقى جزء من التزامك بالطلب.
          </p>
        </section>
      )}

      {/* ── التقديم ─────────────────────────────────────────────────────
          مفيش فورم تقديم على الويب لسه — التسجيل الحقيقي بيحصل جوّه تطبيق الفنيين. فبدل فورم
          بيروح لمكان مش موجود، القنوات دي هي الوجهة الفعلية. */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-2xl font-bold">عايز تتسجّل؟</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          كلّمنا على القناة اللي تناسبك وهنمشّيك في خطوات التسجيل والمستندات المطلوبة.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-[#25D366] px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              كلّمنا على واتساب
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="rounded-xl bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              اتصل بينا <span dir="ltr" className="opacity-80">{phone}</span>
            </a>
          )}
          <Link
            href="/support"
            className="rounded-xl border border-border px-6 py-3 text-center text-sm font-semibold text-primary transition-colors hover:border-primary"
          >
            تواصل معنا
          </Link>
          {email && (
            <a
              href={`mailto:${email}`}
              className="rounded-xl border border-border px-6 py-3 text-center text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary"
              dir="ltr"
            >
              {email}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
