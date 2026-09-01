import Link from 'next/link';
import { fetchLegalEntity } from '@/lib/legal-content';

/**
 * فوتر الموقع (طلب مالك مباشر، docs/08 §99) — «السياسة والاستخدام اللي بيبقى تحت في آخر الموقع»
 * و«علامة © حقوق الملكية… وأي حاجة فيها ملكية أو إدارة هتحط جنبها ELSANE Group بالإنجليزي».
 *
 * الروابط دي **مش تجميلية**: Google Play بيطلب رابط سياسة خصوصية عام وثابت، ورابط حذف حساب عام،
 * والاتنين لازم يبقوا مكتشَفين من أي صفحة في الموقع مش من صفحة واحدة مخفية.
 */
const LINKS = [
  { href: '/legal/terms', label: 'شروط الاستخدام' },
  { href: '/legal/privacy', label: 'سياسة الخصوصية' },
  { href: '/legal/account-deletion', label: 'حذف الحساب' },
];

export async function SiteFooter() {
  const entity = await fetchLegalEntity();
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t bg-muted/30">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <nav className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted-foreground underline-offset-4 hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground">
          منصة {entity.platform_name_ar} (<span dir="ltr">{entity.platform_name_en}</span>) — تُدار بواسطة{' '}
          {entity.company_name_ar} — <span dir="ltr">{entity.company_name_en}</span>
        </p>
        {/* السطور دي بتظهر بس لما تتملى من شاشة الأدمن — «ما تظهرش كسطر فاضي» بنص المالك. */}
        {entity.legal_address && <p className="mt-1 text-sm text-muted-foreground">{entity.legal_address}</p>}
        {(entity.support_email || entity.support_phone) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {entity.support_email && (
              <a className="underline" href={`mailto:${entity.support_email}`} dir="ltr">
                {entity.support_email}
              </a>
            )}
            {entity.support_email && entity.support_phone && <span className="mx-2">·</span>}
            {entity.support_phone && <span dir="ltr">{entity.support_phone}</span>}
          </p>
        )}
        {/* حقوق الطبع والنشر والملكية الفكرية — الاسم القانوني بالإنجليزي جنبها زي ما المالك طلب. */}
        <p className="mt-2 text-sm text-muted-foreground">
          <span dir="ltr">
            © {year} {entity.company_name_en}
          </span>{' '}
          — جميع الحقوق محفوظة. أسماء وعلامات {entity.platform_name_ar} (
          <span dir="ltr">{entity.platform_name_en}</span>) وتصميمات المنصة ومحتواها مملوكة لـ {entity.company_name_ar} —{' '}
          <span dir="ltr">{entity.company_name_en}</span>.
        </p>
      </div>
    </footer>
  );
}
