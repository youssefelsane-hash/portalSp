import Link from 'next/link';
import { LEGAL_ENTITY_AR, LEGAL_ENTITY_EN, PLATFORM_NAME_AR, PLATFORM_NAME_EN } from '@/lib/legal-content';

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

export function SiteFooter() {
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
          منصة {PLATFORM_NAME_AR} (<span dir="ltr">{PLATFORM_NAME_EN}</span>) — تُدار بواسطة {LEGAL_ENTITY_AR} —{' '}
          <span dir="ltr">{LEGAL_ENTITY_EN}</span>
        </p>
        {/* حقوق الطبع والنشر والملكية الفكرية — الاسم القانوني بالإنجليزي جنبها زي ما المالك طلب. */}
        <p className="mt-2 text-sm text-muted-foreground">
          <span dir="ltr">© {year} {LEGAL_ENTITY_EN}</span> — جميع الحقوق محفوظة. أسماء وعلامات {PLATFORM_NAME_AR} (
          <span dir="ltr">{PLATFORM_NAME_EN}</span>) وتصميمات المنصة ومحتواها مملوكة لـ {LEGAL_ENTITY_AR} —{' '}
          <span dir="ltr">{LEGAL_ENTITY_EN}</span>.
        </p>
      </div>
    </footer>
  );
}
