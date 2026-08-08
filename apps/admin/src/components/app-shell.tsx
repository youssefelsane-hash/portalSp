'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'نظرة عامة' },
  { href: '/employees', label: 'الموظفين' },
  { href: '/technicians', label: 'الفنيين' },
  { href: '/customers', label: 'العملاء' },
  { href: '/orders', label: 'الطلبات' },
  { href: '/reports', label: 'التقارير' },
  { href: '/support', label: 'الشكاوى' },
  { href: '/payouts', label: 'طلبات الصرف' },
  { href: '/promotions', label: 'أكواد الخصم' },
  { href: '/cancellation-reasons', label: 'أسباب الإلغاء' },
  { href: '/catalog', label: 'الكتالوج' },
  { href: '/geo', label: 'المدن والمناطق' },
  { href: '/settings', label: 'الإعدادات' },
  { href: '/feature-flags', label: 'Feature Flags' },
  { href: '/audit-log', label: 'سجل النشاط' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-s bg-muted/30">
        <div className="px-4 py-4 font-semibold">baytak إدارة</div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
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
