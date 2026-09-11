import Link from 'next/link';

import { fetchLegalEntity } from '@/lib/legal-content';
import { fetchSupportContactServer } from '@/lib/public-info';
import { SOCIAL_LABELS_AR, fetchSocialLinks } from '@/lib/social-links';
import { SocialIcon } from '@/components/social-icons';

/**
 * فوتر الموقع (docs/08 §99 → §136 → **إعادة بناء بريميوم 2026-09-11**).
 *
 * بلاغ المالك بالحرف: «شكلها بدائي قوي». المشكلة مكانتش في المحتوى — كان صح وكامل — كانت في
 * إن كل حاجة على نفس الوزن البصري: أعمدة، قنوات، وسطور قانونية كلها بنفس حجم الخط ونفس اللون
 * ونفس المسافة، فالعين مالقتش تسلسل تمشي عليه. المرجع اللي المالك حدده (Booking/طلبات/مواقع
 * السيارات الفخمة) مشترك في تلات حاجات بالظبط، وهي اللي اتنفّذت هنا:
 *
 *   ١. **ثلاث طبقات بأوزان مختلفة**: علامة + دعوة تواصل فوق (الأثقل)، تنقّل في النص، شريط
 *      قانوني رفيع تحت (الأخف). مش صف واحد طويل.
 *   ٢. **عناوين الأعمدة صغيرة ومتباعدة الحروف (small-caps style)** بلون خافت — ده اللي بيخلي
 *      الروابط نفسها تبان أوضح من غير ما نكبّرها.
 *   ٣. **حذف الحساب في الشريط القانوني**، مش كعمود بارز. طلب المالك حرفيًا: «يتحط في مكان
 *      هادي زي ما الشركات بتعمل مش قدام الناس» — والمكان القياسي عند كل الشركات هو نفس السطر
 *      اللي فيه الشروط والخصوصية.
 *
 * ## قاعدة صارمة محفوظة: مفيش لينك ميت هنا
 *
 * الفوتر بيتعرض على **كل** صفحة، فأي لينك مكسور فيه بيتضرب من كل مكان. ومسح صفحات الويب
 * (`scripts/customer-web-screens-audit.js`) لقط الحالة دي قبل كده: لينك لـ`/support` كان بيدّي
 * 404. كل بند تحت مربوط بوجهة **موجودة فعلاً**، والبنود اللي مالهاش صفحة مستقلة (الضمان،
 * الإلغاء) مربوطة بالبند المقابل في وثيقة الشروط بالـanchor بتاعه.
 *
 * القنوات المشروطة (واتساب، الاتصال، البريد) بتختفي بالكامل لو الإدارة ما ملّتش قيمتها.
 */

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'أسطى',
    links: [
      { href: '/about', label: 'من نحن' },
      { href: '/about#how-it-works', label: 'كيف تعمل أسطى' },
      { href: '/about#coverage', label: 'مناطق التغطية' },
      { href: '/join', label: 'انضم كمقدم خدمة' },
    ],
  },
  {
    title: 'الخدمات',
    links: [
      { href: '/search', label: 'كل الخدمات' },
      { href: '/technicians', label: 'الفنيون' },
      { href: '/projects', label: 'المشاريع' },
      { href: '/orders', label: 'طلباتي' },
    ],
  },
  {
    title: 'الدعم',
    links: [
      { href: '/support', label: 'تواصل معنا' },
      { href: '/account/complaints', label: 'الشكاوى' },
      // البندان دول نص قانوني قايم بالفعل — الربط بالـanchor بيوصّل لمحتوى حقيقي بدل صفحة
      // تسويقية فاضية تقول نفس الكلام بصياغة تانية (وتتعارض معاه بعدين).
      { href: '/legal/terms#section-10', label: 'الضمان' },
      { href: '/legal/terms#section-9', label: 'الإلغاء والاسترداد' },
    ],
  },
];

/** روابط الشريط القانوني السفلي — أخف وزن بصري في الصفحة كلها، وده مكان حذف الحساب. */
const LEGAL_LINKS = [
  { href: '/legal/terms', label: 'شروط الاستخدام' },
  { href: '/legal/privacy', label: 'سياسة الخصوصية' },
  { href: '/legal/account-deletion', label: 'حذف الحساب' },
];

export async function SiteFooter() {
  // التلاتة بالتوازي: الفوتر بيتعرض على كل صفحة، فتسلسلهم كان هيضيف رحلتين شبكة لكل طلب.
  const [entity, support, socialLinks] = await Promise.all([
    fetchLegalEntity(),
    fetchSupportContactServer(),
    fetchSocialLinks(),
  ]);
  const year = new Date().getFullYear();

  const supportEnabled = Boolean(support?.enabled);
  const whatsappUrl = supportEnabled ? support?.whatsapp_url : null;
  const callPhone = supportEnabled ? support?.phone_number : null;
  const email = entity.support_email ?? (supportEnabled ? support?.email : null) ?? null;
  const hasContactRow = Boolean(whatsappUrl || callPhone || email);

  return (
    <footer className="mt-20 border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4">
        {/* ── الطبقة الأولى: العلامة + التواصل ─────────────────────────────────────────────
            أثقل عنصر في الفوتر، وبياخد لوحده مساحة أوسع من أي عمود — ده اللي بيدّي الإحساس
            إن الفوتر «مصمّم» مش مجرد قايمة روابط في الآخر. */}
        <div className="grid gap-10 py-14 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="text-2xl font-bold text-primary">{entity.platform_name_ar}</p>
            <p className="mt-3 max-w-sm text-sm leading-7 text-muted">
              صنايعية معتمدين لكل شغلانة في البيت — سعر واضح قبل ما تبدأ، تتبّع لحظي، ودفع آمن.
            </p>

            {socialLinks.length > 0 && (
              <ul className="mt-6 flex flex-wrap items-center gap-2.5">
                {socialLinks.map((link) => (
                  <li key={link.network}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={SOCIAL_LABELS_AR[link.network]}
                      title={SOCIAL_LABELS_AR[link.network]}
                      className="motion-press flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-variant/60 transition-colors hover:border-primary hover:bg-primary/10"
                    >
                      {/* طلب مالك 2026-09-11: الأيقونة بلون البراند، مش رمادية ولا نص. */}
                      <SocialIcon network={link.network} brand className="h-[18px] w-[18px]" />
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {hasContactRow && (
              <ul className="mt-6 space-y-2 text-sm">
                {callPhone && (
                  <li>
                    <a href={`tel:${callPhone}`} className="text-foreground transition-colors hover:text-primary" dir="ltr">
                      {callPhone}
                    </a>
                  </li>
                )}
                {whatsappUrl && (
                  <li>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted transition-colors hover:text-primary"
                    >
                      تواصل عبر واتساب
                    </a>
                  </li>
                )}
                {email && (
                  <li>
                    <a href={`mailto:${email}`} className="text-muted transition-colors hover:text-primary" dir="ltr">
                      {email}
                    </a>
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* ── الطبقة الثانية: التنقّل ──────────────────────────────────────────────────── */}
          <nav className="grid gap-8 sm:grid-cols-3 lg:col-span-8" aria-label="روابط الموقع">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                {/* بلا `tracking-*` ولا `uppercase` عمدًا: تباعد الحروف بيكسر اتصال الحروف
                    العربية (الكلمة بتتفكّك لحروف منفصلة)، و`uppercase` مالهاش أي أثر على
                    العربية أصلاً. التمييز البصري هنا بالحجم والوزن واللون بس. */}
                <h2 className="text-xs font-semibold text-muted">{column.title}</h2>
                <ul className="mt-4 space-y-3 text-sm">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-foreground/85 transition-colors hover:text-primary">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ── الطبقة الثالثة: الشريط القانوني ──────────────────────────────────────────────
            أخف وزن: مقاس ١٢px ولون خافت وسطر واحد. البيانات الرسمية (السجل/الضريبي/العنوان)
            مطلوبة قانونًا لكن مش المفروض تنافس الروابط بصريًا — فهي هنا مش فوق. */}
        <div className="border-t border-border py-8 text-xs leading-6 text-muted">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p>
              <span dir="ltr">
                © {year} {entity.company_name_en}
              </span>{' '}
              — جميع الحقوق محفوظة.
            </p>

            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition-colors hover:text-primary">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 space-y-1">
            <p>
              {entity.platform_name_ar} (<span dir="ltr">{entity.platform_name_en}</span>) — تُدار بواسطة{' '}
              {entity.company_name_ar} — <span dir="ltr">{entity.company_name_en}</span>
            </p>
            {entity.legal_address && <p>{entity.legal_address}</p>}
            {(entity.commercial_register || entity.tax_id) && (
              <p>
                {entity.commercial_register && (
                  <>
                    السجل التجاري: <span dir="ltr">{entity.commercial_register}</span>
                  </>
                )}
                {entity.commercial_register && entity.tax_id && <span className="mx-2">·</span>}
                {entity.tax_id && (
                  <>
                    الرقم الضريبي: <span dir="ltr">{entity.tax_id}</span>
                  </>
                )}
              </p>
            )}
            <p>
              {entity.platform_name_ar} وشعارها وتصميمات ومحتوى المنصة مملوكة لـ {entity.company_name_ar} —{' '}
              <span dir="ltr">{entity.company_name_en}</span>.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
