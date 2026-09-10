import type { Metadata } from 'next';
import Link from 'next/link';

import { fetchLegalEntity } from '@/lib/legal-content';
import { fetchCoverageCities, fetchTrustInfo } from '@/lib/public-info';

export const metadata: Metadata = {
  title: 'من نحن — أسطى',
  description: 'أسطى (OSTA) منصة للخدمات المنزلية والمهنية: إزاي بتشتغل، ومناطق التغطية الحالية.',
};

/**
 * «من نحن» + «كيف تعمل أسطى» + «مناطق التغطية» — صفحة واحدة بتلات مراسي (docs/08 §136).
 *
 * **ليه صفحة واحدة مش تلاتة؟** الفوتر بيوصّل لتلات بنود (`/about`، `/about#how-it-works`،
 * `/about#coverage`)، والمحتوى الحقيقي المتاح لكل بند فقرة أو اتنين. تلات صفحات منفصلة كانت
 * هتبقى تلات صفحات شبه فاضية — والمرساة بتدّي نفس تجربة التنقّل بمحتوى مترابط.
 *
 * **صفر ادعاءات مخترعة**: مفيش أرقام فنيين ولا سنين خبرة ولا مدن مكتوبة بالإيد. كل رقم أو
 * اسم في الصفحة دي جاي من السيرفر:
 *   - مدن التغطية من `GET /cities` (النشطة بس) — لو فاضية، الصفحة بتقول «لسه بنوسّع» صراحة.
 *   - مدة الضمان من `GET /trust-info` (نفس المصدر اللي الضمان بيتحسب منه فعليًا) — القسم
 *     بيختفي بالكامل لو الجلب فشل بدل ما يقول رقم مش مضمون.
 *   - اسم الجهة المشغّلة من `GET /legal-entity`.
 *
 * خطوات «كيف تعمل» بتوصف الفلو المنفَّذ فعلاً في `OrdersService.create()` ورحلة الحجز في
 * التطبيقات — مش وعد تسويقي.
 */

const STEPS: { title: string; body: string }[] = [
  {
    title: 'قول لنا مشكلتك',
    body: 'تختار الخدمة من الفئات أو تكتب مشكلتك بكلامك العادي، وتضيف صور لو ده هيوضّح الشغل أكتر.',
  },
  {
    title: 'حدّد العنوان والموعد',
    body: 'تحط عنوانك على الخريطة وتختار اليوم اللي يناسبك. لو الطلب مستعجل، بيتعامل كطلب فوري.',
  },
  {
    title: 'شوف السعر قبل ما تأكّد',
    body: 'بيوصلك تفصيل السعر بالكامل قبل التأكيد. الخدمات اللي محتاجة معاينة بتاخد عرض سعر من الفني بعد ما يشوف الشغل، وإنت اللي توافق أو لأ.',
  },
  {
    title: 'اختار المنفّذ',
    body: 'إما تسيب المنصة تختارلك أقرب فني متاح ومناسب، أو تختار بنفسك من قائمة الفنيين المتاحين بتقييماتهم وأسعارهم.',
  },
  {
    title: 'تابع التنفيذ وادفع',
    body: 'تتابع حالة الطلب لحظة بلحظة وتقدر تتكلّم مع الفني من جوّه الطلب. الدفع كاش أو من محفظتك أو أونلاين بعد ما الشغل يخلص.',
  },
];

export default async function AboutPage() {
  const [entity, cities, trust] = await Promise.all([
    fetchLegalEntity(),
    fetchCoverageCities(),
    fetchTrustInfo(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      {/* ── من نحن ─────────────────────────────────────────────────────── */}
      <header>
        <p className="text-sm font-medium text-primary">من نحن</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">
          {entity.platform_name_ar} — خدمات منزلية ومهنية بسعر واضح ومنفّذ معروف
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          {entity.platform_name_ar} (<span dir="ltr">{entity.platform_name_en}</span>) منصة بتوصّل
          بينك وبين فنيين ومقدّمي خدمة متسجّلين ومراجَعين، لكل حاجة في البيت أو المكان من سباكة
          وكهرباء لتشطيب وصيانة. المنصة تُدار بواسطة {entity.company_name_ar} —{' '}
          <span dir="ltr">{entity.company_name_en}</span>.
        </p>
        <p className="mt-3 text-base leading-relaxed text-muted">
          الفكرة بسيطة: تعرف السعر قبل ما تأكّد، وتعرف مين اللي جايلك، وتفضل تعرف الطلب واصل
          لفين — من غير مكالمات ولا مساومة.
        </p>
      </header>

      {/* ── كيف تعمل أسطى ──────────────────────────────────────────────── */}
      <section id="how-it-works" className="mt-14 scroll-mt-24">
        <h2 className="text-2xl font-bold">كيف تعمل أسطى</h2>
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

        {/* الضمان بيتعرض بالمدة النافذة دلوقتي بس — لو السيرفر ما ردّش، القسم بيختفي بدل ما
            يقول رقم ممكن يكون قديم. */}
        {trust && (
          <div className="mt-6 rounded-2xl border border-border bg-surface-variant/50 p-5">
            <h3 className="font-semibold">وبعد ما الشغل يخلص</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              الخدمات المنفّذة عليها ضمان {trust.warranty_label_ar} — لو ظهرت مشكلة في نفس الشغل
              خلال المدة دي، تفتح طلب إعادة زيارة من صفحة الطلب من غير أي رسوم إضافية عليك.
            </p>
          </div>
        )}
      </section>

      {/* ── مناطق التغطية ──────────────────────────────────────────────── */}
      <section id="coverage" className="mt-14 scroll-mt-24">
        <h2 className="text-2xl font-bold">مناطق التغطية</h2>
        {cities.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-muted">
              بنخدم دلوقتي في المدن دي. التغطية جوّه كل مدينة بتتحدّد بالمنطقة، فأدق طريقة تتأكد
              إننا نوصلك: حدّد عنوانك على الخريطة وهتشوف الخدمات المتاحة عندك فورًا.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {cities.map((city) => (
                <li
                  key={city.id}
                  className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium"
                >
                  {city.name_ar}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            لسه بنوسّع التغطية. لو عايز تعرف إحنا وصلنا منطقتك ولا لأ، كلّمنا من{' '}
            <Link href="/support" className="text-primary underline underline-offset-4">
              صفحة التواصل
            </Link>{' '}
            وهنردّ عليك.
          </p>
        )}
      </section>

      {/* ── نداءات الفعل ───────────────────────────────────────────────── */}
      <div className="mt-14 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row">
        <Link
          href="/"
          className="rounded-xl bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          ابدأ طلبك
        </Link>
        <Link
          href="/join"
          className="rounded-xl border border-border px-6 py-3 text-center text-sm font-semibold text-primary transition-colors hover:border-primary"
        >
          انضم كمقدم خدمة
        </Link>
        <Link
          href="/support"
          className="rounded-xl border border-border px-6 py-3 text-center text-sm font-semibold text-muted transition-colors hover:border-primary hover:text-primary"
        >
          تواصل معنا
        </Link>
      </div>
    </div>
  );
}
