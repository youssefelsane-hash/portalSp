'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Avatar,
  AvatarFallback,
} from '@/components/ui/avatar';
import {
  Activity,
  BarChart3,
  Banknote,
  Bell,
  BellRing,
  Building,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  GraduationCap,
  HandCoins,
  Home as HomeIcon,
  ImageIcon,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListX,
  LogOut,
  Map,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Package,
  PieChart,
  QrCode,
  Route as RouteIcon,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Star,
  Tag,
  ToggleLeft,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon; permission?: string };
type NavGroup = { label: string; items: NavItem[] };

// نظام التصميم المشترك (docs/12، مرحلة تحسين UI/UX 2026-08-13) — كانت الـ30 صفحة كلها في قايمة
// واحدة مسطّحة بلا تجميع ولا أيقونات، ترتيبها تاريخي (حسب وقت البناء) مش منطقي (مثلاً "الأدوار
// والصلاحيات" جنب "ترشيح QR الفني"). اتقسّمت هنا لمجموعات بمعنى تشغيلي واحد — بنية معلومات فعلية،
// نفس مبدأ "console تشغيلي احترافي مش صفحات CRUD متجمّعة" المطلوب صراحة في الطلب الأول.
//
// **الصلاحيات (P0-3) محفوظة بالحرف من غير أي تغيير** — كل `permission` هنا مطابق تمامًا لما كان
// موجود قبل إعادة التجميع؛ إعادة الترتيب مجرد بصري، مالوش أي علاقة بمنطق fail-closed تحت.
const NAV_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [{ href: '/', label: 'نظرة عامة', icon: LayoutDashboard, permission: 'reports.view' }],
  },
  {
    label: 'العمليات',
    items: [
      { href: '/operations', label: 'مركز العمليات', icon: Activity },
      { href: '/orders', label: 'الطلبات', icon: ClipboardList },
      { href: '/recurring-orders', label: 'الطلبات المتكررة', icon: CalendarClock, permission: 'recurring_orders.view' },
      { href: '/support', label: 'الشكاوى', icon: Megaphone },
      { href: '/support-tickets', label: 'تذاكر الدعم', icon: LifeBuoy },
      { href: '/support-chat', label: 'محادثات الدعم', icon: MessageSquare },
      { href: '/internal-chat', label: 'المحادثات الداخلية', icon: MessagesSquare },
    ],
  },
  {
    label: 'الفنيين',
    items: [
      { href: '/technicians', label: 'الفنيين', icon: Wrench },
      {
        href: '/technicians/category-declarations',
        label: 'طابور تصريحات التخصصات',
        icon: ClipboardCheck,
        permission: 'technicians.approve',
      },
      { href: '/technician-companies', label: 'شركات/فرق الفنيين', icon: Building2 },
      { href: '/technician-levels', label: 'سياسة مستويات الفنيين', icon: Star },
      { href: '/technician-referrals', label: 'ترشيح QR الفني', icon: QrCode },
      { href: '/technician-kpi', label: 'KPI الشهري', icon: BarChart3 },
      { href: '/technician-progression', label: 'المسار الوظيفي', icon: RouteIcon },
      { href: '/academy', label: 'الأكاديمية', icon: GraduationCap },
    ],
  },
  {
    label: 'العملاء',
    items: [{ href: '/customers', label: 'العملاء', icon: Users }],
  },
  {
    label: 'الكتالوج والتسعير',
    items: [
      { href: '/pricing', label: 'محرك التسعير', icon: DollarSign, permission: 'catalog.manage' },
      { href: '/catalog', label: 'الكتالوج', icon: Package },
      { href: '/buildings', label: 'العمائر', icon: Building },
      { href: '/domestic-workers', label: 'الخدمات المنزلية', icon: HomeIcon },
      { href: '/geo', label: 'المدن والمناطق', icon: Map },
    ],
  },
  {
    label: 'المالية',
    items: [
      { href: '/payouts', label: 'طلبات الصرف', icon: Banknote },
      { href: '/instapay-confirmations', label: 'تأكيدات InstaPay', icon: Landmark, permission: 'payments.confirm_manual' },
      {
        href: '/domestic-worker-earnings',
        label: 'اعتماد أرباح الخدمات المنزلية',
        icon: HandCoins,
        permission: 'domestic_workers.approve_earnings',
      },
      { href: '/promotions', label: 'أكواد الخصم', icon: Tag },
    ],
  },
  {
    label: 'التقارير',
    items: [{ href: '/reports', label: 'التقارير', icon: PieChart, permission: 'reports.view' }],
  },
  {
    label: 'النظام والإعدادات',
    items: [
      { href: '/employees', label: 'الموظفين', icon: UserCog },
      { href: '/roles', label: 'الأدوار والصلاحيات', icon: Shield, permission: 'roles.manage' },
      { href: '/notification-routing', label: 'توجيه الإشعارات', icon: Bell },
      { href: '/notification-type-configs', label: 'إعدادات أنواع الإشعارات', icon: BellRing },
      { href: '/cancellation-reasons', label: 'أسباب الإلغاء', icon: ListX },
      { href: '/settings', label: 'الإعدادات', icon: Settings, permission: 'settings.manage' },
      { href: '/branding', label: 'البراندنج', icon: ImageIcon, permission: 'branding.manage' },
      { href: '/feature-flags', label: 'Feature Flags', icon: ToggleLeft },
      { href: '/audit-log', label: 'سجل النشاط', icon: ScrollText, permission: 'audit.view' },
      { href: '/security', label: 'الأمان والأجهزة', icon: KeyRound },
      { href: '/security-center', label: 'مركز الأمان', icon: ShieldAlert, permission: 'security.alerts.view' },
    ],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

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
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-s bg-muted/30">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            ص
          </div>
          <span className="font-semibold">صُنّاع — إدارة</span>
        </div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4">
          {visibleGroups.map((group) => (
            <div key={group.label || 'root'}>
              {group.label && (
                <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                        isActive && 'bg-accent text-accent-foreground font-medium',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        {/* placeholder للوجو/قواعد الاستخدام الحقيقية — docs/06-vision-brief-sanaa.md §0،
            لسه هتتبعت من صاحب المشروع. مفيش نص/لوجو مُخترَع هنا عمدًا. */}
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          <div>© الصانع جروب</div>
          <div className="mt-1 text-muted-foreground/60">قواعد الاستخدام (قريبًا)</div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-background/80 px-6 py-3 backdrop-blur">
          <div />
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials(user.full_name)}</AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground">{user.full_name}</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" />
              تسجيل الخروج
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
