import Link from 'next/link';

import { fetchLegalEntity } from '@/lib/legal-content';
import { fetchSupportContactServer } from '@/lib/public-info';
import { SOCIAL_LABELS_AR, fetchSocialLinks } from '@/lib/social-links';
import { SocialIcon } from '@/components/social-icons';

/**
 * فوتر الموقع (docs/08 §99 ثم §136 — توسعة بطلب مالك 2026-09-10).
 *
 * **البنية القانونية ما اتغيرتش**: نفس بيانات `GET /legal-entity` بالحرف، ونفس شرط «أي قيمة
 * لسه فاضية ما تظهرش كسطر فاضي». اللي اتوسّع هو الطبقة اللي فوقها: أيقونات سوشيال، قنوات
 * تواصل، وتلات أعمدة تنقّل.
 *
 * ## قاعدة صارمة: مفيش لينك ميت هنا
 *
 * الفوتر بيتعرض على **كل** صفحة، فأي لينك مكسور فيه بيتضرب من كل مكان. ومسح صفحات الويب
 * (`scripts/customer-web-screens-audit.js`) لقط بالظبط الحالة دي قبل كده: لينك لـ`/support`
 * كان بيدّي 404 لأن الصفحة مكانتش موجودة. عشان كده كل بند تحت مربوط بوجهة **موجودة فعلاً**،
 * والبنود اللي مالهاش صفحة مستقلة (الضمان، الإلغاء) مربوطة بالبند المقابل في وثيقة الشروط
 * بالـanchor بتاعه — نص حقيقي مش صفحة فاضية.
 *
 * القنوات المشروطة (واتساب، الاتصال، البريد) بتختفي بالكامل لو الإدارة ما ملّتش قيمتها.
 */

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'OSTA',
    links: [
      { href: '/about', label: 'من نحن' },
      { href: '/about#how-it-works', label: 'كيف تعمل أسطى' },
      { href: '/search', label: 'الخدمات' },
      { href: '/about#coverage', label: 'مناطق التغطية' },
      { href: '/join', label: 'انضم كمقدم خدمة' },
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
  {
    title: 'قانوني',
    links: [
      { href: '/legal/terms', label: 'شروط الاستخدام' },
      { href: '/legal/privacy', label: 'سياسة الخصوصية' },
      { href: '/legal/account-deletion', label: 'حذف الحساب والبيانات' },
    ],
  },
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

  return (
    <footer className="mt-16 border-t border-border bg-surface-variant/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-12">
        {/* ── صف السوشيال + قنوات التواصل ─────────────────────────────── */}
        {(socialLinks.length > 0 || whatsappUrl || callPhone || email) && (
          <div className="flex flex-col items-center gap-5 border-b border-border pb-8 text-center">
            {socialLinks.length > 0 && (
              <ul className="flex flex-wrap items-center justify-center gap-3">
                {socialLinks.map((link) => (
                  <li key={link.network}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={SOCIAL_LABELS_AR[link.network]}
                      title={SOCIAL_LABELS_AR[link.network]}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-primary hover:text-primary"
                    >
                      <SocialIcon network={link.network} className="h-5 w-5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
              {whatsappUrl && (
                <li>
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-primary">
                    واتساب
                  </a>
                </li>
              )}
              {callPhone && (
                <li>
                  <a href={`tel:${callPhone}`} className="text-muted hover:text-primary">
                    اتصل بنا
                  </a>
                </li>
              )}
              <li>
                <Link href="/support" className="text-muted hover:text-primary">
                  تواصل معنا
                </Link>
              </li>
              {email && (
                <li>
                  <a href={`mailto:${email}`} className="text-muted hover:text-primary" dir="ltr">
                    {email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ── تلات أعمدة، مش خمسة وستة ─────────────────────────────────── */}
        <nav className="grid gap-8 py-10 sm:grid-cols-3" aria-label="روابط الموقع">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-muted underline-offset-4 hover:text-primary hover:underline">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── الجزء الرسمي الصغير ───────────────────────────────────────── */}
        <div className="border-t border-border pt-8 text-sm text-muted">
          <p>
            {entity.platform_name_ar} (<span dir="ltr">{entity.platform_name_en}</span>) — تُدار بواسطة{' '}
            {entity.company_name_ar} — <span dir="ltr">{entity.company_name_en}</span>
          </p>
          {entity.legal_address && <p className="mt-1">{entity.legal_address}</p>}
          {(entity.commercial_register || entity.tax_id) && (
            <p className="mt-1">
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
          {(entity.support_email || entity.support_phone) && (
            <p className="mt-1">
              {entity.support_email && (
                <a className="underline underline-offset-4" href={`mailto:${entity.support_email}`} dir="ltr">
                  {entity.support_email}
                </a>
              )}
              {entity.support_email && entity.support_phone && <span className="mx-2">·</span>}
              {entity.support_phone && <span dir="ltr">{entity.support_phone}</span>}
            </p>
          )}

          <p className="mt-5">
            <span dir="ltr">
              © {year} {entity.company_name_en}
            </span>{' '}
            — جميع الحقوق محفوظة.
          </p>
          <p className="mt-1">
            {entity.platform_name_ar} (<span dir="ltr">{entity.platform_name_en}</span>) وشعارها وتصميمات ومحتوى المنصة
            مملوكة لـ {entity.company_name_ar} — <span dir="ltr">{entity.company_name_en}</span>.
          </p>
        </div>
      </div>
    </footer>
  );
}
