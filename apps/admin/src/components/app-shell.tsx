'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// P0-3 (مراجعة أمان شاملة 2026-08-13، docs/12): كل عنصر ممكن ياخد `permission` اختياري — لو
// موجود، العنصر بيتخفي إلا لو الأدمن عنده الصلاحية دي فعلاً (`hasPermission()`, من
// GET /admin/me/permissions). عناصر بلا `permission` مقصودة عمداً — الـbackend نفسه بيفتح
// الـGET بتاعها لأي حساب أدمن (قرار متعمّد موثّق في تعليقات الكنترولرز المعنية، مش سهو).
//
// **النطاق هنا مقصور على الحالات اللي فعلاً بترفض من الباك-إند بلا الصلاحية دي** (نظرة عامة/
// التقارير/الطلبات المتكررة/سجل النشاط — كانت هتبان فاضية/بترمي خطأ من غير الإخفاء ده) **زائد
// الأمثلة اللي المالك سمّاها صراحة في المراجعة الأمنية** (محرك التسعير/الأدوار والصلاحيات/
// الإعدادات). باقي الصفحات (الموظفين، الكتالوج، المدن، إلخ) الـGET بتاعها مفتوح لأي أدمن عمدًا،
// فمتفلترتش هنا — إخفاء أوسع (حسب الصلة التشغيلية لا الحجب الفعلي) نطاق مرحلة تحسين UI/UX
// القادمة (`docs/12`)، مش P0.
const NAV_ITEMS: { href: string; label: string; permission?: string }[] = [
  { href: '/', label: 'نظرة عامة', permission: 'reports.view' },
  { href: '/pricing', label: 'محرك التسعير', permission: 'catalog.manage' },
  { href: '/employees', label: 'الموظفين' },
  { href: '/roles', label: 'الأدوار والصلاحيات', permission: 'roles.manage' },
  { href: '/technician-referrals', label: 'ترشيح QR الفني' },
  { href: '/technician-kpi', label: 'KPI الشهري' },
  { href: '/technician-progression', label: 'المسار الوظيفي' },
  { href: '/technicians', label: 'الفنيين' },
  { href: '/customers', label: 'العملاء' },
  { href: '/orders', label: 'الطلبات' },
  { href: '/reports', label: 'التقارير', permission: 'reports.view' },
  { href: '/support', label: 'الشكاوى' },
  { href: '/support-tickets', label: 'تذاكر الدعم' },
  { href: '/support-chat', label: 'محادثات الدعم' },
  { href: '/internal-chat', label: 'المحادثات الداخلية' },
  { href: '/payouts', label: 'طلبات الصرف' },
  { href: '/promotions', label: 'أكواد الخصم' },
  { href: '/cancellation-reasons', label: 'أسباب الإلغاء' },
  { href: '/buildings', label: 'العمائر' },
  { href: '/domestic-workers', label: 'الخدمات المنزلية' },
  { href: '/recurring-orders', label: 'الطلبات المتكررة', permission: 'recurring_orders.view' },
  { href: '/notification-routing', label: 'توجيه الإشعارات' },
  { href: '/technician-companies', label: 'شركات/فرق الفنيين' },
  { href: '/technician-levels', label: 'سياسة مستويات الفنيين' },
  { href: '/academy', label: 'الأكاديمية' },
  { href: '/catalog', label: 'الكتالوج' },
  { href: '/geo', label: 'المدن والمناطق' },
  { href: '/settings', label: 'الإعدادات', permission: 'settings.manage' },
  { href: '/feature-flags', label: 'Feature Flags' },
  { href: '/audit-log', label: 'سجل النشاط', permission: 'audit.view' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  // fail-closed: عنصر ليه permission بيتخفي إلا لو hasPermission() أكّدت الوجود — مش بيتفترض
  // مفتوح لحد ما نتأكد. لو الصلاحيات لسه بتتحمّل (permissions=null)، hasPermission() بترجّع
  // false، فالعناصر المقيّدة بتفضل مخفية لحظيًا (مش وميض ظاهر-مختفي).
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-s bg-muted/30">
        <div className="px-4 py-4 font-semibold">صُنّاع — إدارة</div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {visibleNavItems.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground font-medium',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* placeholder للوجو/قواعد الاستخدام الحقيقية — docs/06-vision-brief-sanaa.md §0،
            لسه هتتبعت من صاحب المشروع. مفيش نص/لوجو مُخترَع هنا عمدًا. */}
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          <div>© الصانع جروب</div>
          <div className="mt-1 text-muted-foreground/60">قواعد الاستخدام (قريبًا)</div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div />
          <div className="flex items-center gap-4">
            {user && <span className="text-sm text-muted-foreground">{user.full_name}</span>}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              تسجيل الخروج
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
