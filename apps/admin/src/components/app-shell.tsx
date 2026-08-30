'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
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
  Home,
  ImageIcon,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListX,
  ShieldCheck,
  LogOut,
  Map,
  Megaphone,
  Send,
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
      { href: '/recurring-orders', label: 'الحجوزات المتكررة', icon: CalendarClock, permission: 'recurring_orders.view' },
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
      { href: '/technician-levels', label: 'مستويات الفنيين والمساعدين', icon: Star },
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
      { href: '/geo', label: 'المدن والمناطق', icon: Map },
    ],
  },
  {
    label: 'المالية',
    items: [
      { href: '/projects', label: 'المشروعات', icon: Building2, permission: 'projects.view' },
      { href: '/warranty-plans', label: 'خطط الضمان', icon: ShieldCheck, permission: 'warranty.manage' },
      { href: '/warranty-claims', label: 'مطالبات الضمان', icon: ShieldCheck, permission: 'warranty.view' },
      { href: '/installments', label: 'التقسيط', icon: Landmark, permission: 'installments.view' },
      { href: '/payouts', label: 'طلبات الصرف', icon: Banknote },
      { href: '/instapay-confirmations', label: 'تأكيدات InstaPay', icon: Landmark, permission: 'payments.confirm_manual' },
      { href: '/promotions', label: 'أكواد الخصم', icon: Tag },
      // ADR-0046 — الحملات التسويقية: إشعارات تلقائية بتفكّر العميل بالخدمات.
      { href: '/campaigns', label: 'الحملات التسويقية', icon: Send, permission: 'campaigns.manage' },
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
      { href: '/homepage-content', label: 'محتوى الصفحة الرئيسية', icon: Home, permission: 'settings.manage' },
      { href: '/feature-flags', label: 'Feature Flags', icon: ToggleLeft },
      { href: '/audit-log', label: 'سجل النشاط', icon: ScrollText, permission: 'audit.view' },
      { href: '/security', label: 'الأمان والأجهزة', icon: KeyRound },
      { href: '/security-center', label: 'مركز الأمان', icon: ShieldAlert, permission: 'security.alerts.view' },
    ],
  },
];

// docs/08 §63.ب4 — الشريط الجانبي كان بيرجع لفوق مع كل تنقّل ويوّه الأدمن.
//
// السبب: `AppShell` (وجوّاه `<nav>`) كان متكرر جوّه 57 صفحة بدل ما يكون في `layout`، فكل تنقّل
// بيعمل unmount/remount للشريط و`scrollTop` بيرجع صفر. الحل: الشِل الحقيقي بقى في الـlayout
// (بيتركّب مرة واحدة ويعيش عبر كل التنقّلات)، والنسخ المتداخلة جوّه الصفحات بقت **pass-through**.
//
// اخترنا الـcontext بدل تعديل 57 صفحة دفعة واحدة: صفر مخاطرة على أي صفحة، ونفس النتيجة بالظبط.
// الصفحات ممكن تسيب `<AppShell>` بتاعتها أو تشيلها بعدين — الاتنين شغالين.
const AppShellMountedContext = createContext(false);

/** المسارات اللي بتترسم من غير شِل (شاشة الدخول — مفيش قايمة جانبية قبل تسجيل الدخول). */
const BARE_ROUTES = new Set(['/login']);

/**
 * حفظ/استرجاع مكان الـscroll لكل مسار (docs/08 §63.ب6).
 *
 * `<main>` بقى هو حاوية الـscroll (مش المستند)، عشان الشريط الجانبي يفضل ثابت. النتيجة إن
 * استرجاع الـscroll التلقائي بتاع المتصفح مبقاش بيشتغل عليه، فبنعمله بنفسنا: بنفتكر آخر مكان
 * لكل مسار، فلما الأدمن يرجع للقايمة يلاقي نفسه في نفس الصف اللي كان فيه مش في أول الصفحة.
 */
function useMainScrollMemory(pathname: string) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(`admin:scroll:${pathname}`) ?? 0);
    } catch {
      // sessionStorage ممكن يرمي في وضع خاص/حظر بيانات الموقع — تجاهل واعتبرها بداية الصفحة.
    }
    el.scrollTop = Number.isFinite(saved) ? saved : 0;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          sessionStorage.setItem(`admin:scroll:${pathname}`, String(el.scrollTop));
        } catch {
          // نفس السبب فوق — الحفظ رفاهية، مش شرط لعمل الصفحة.
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return mainRef;
}

/**
 * ملاحة الرجوع (docs/08 §63.ب6).
 *
 * الشكوى: «أرجع لورا يوديني حتة تانية خالص». السبب إن زراير "رجوع للقايمة" كانت بتعمل
 * `router.push('/list')` — **دفع** مش رجوع: بيضيف سجل جديد للتاريخ، فحالة القايمة (الصفحة،
 * الفلاتر، مكان الـscroll) بتضيع، وزرار الرجوع الحقيقي للمتصفح بيبقى في مكان غير متوقع.
 *
 * الشِل بقى دايم (بيتركّب مرة واحدة)، فهو الوحيد اللي بيشوف **كل** تغييرات المسار — فبيمسك
 * عدّاد للتنقّلات اللي حصلت جوّه التطبيق. `back()` بترجع فعليًا بس لو فيه صفحة سابقة جوّه
 * التطبيق؛ غير كده (فتح مباشر للرابط، أو refresh) بتروح للمسار البديل.
 */
const AdminBackContext = createContext<((fallbackHref: string) => void) | null>(null);

export function useAdminBack(fallbackHref: string): () => void {
  const back = useContext(AdminBackContext);
  const router = useRouter();
  return () => {
    if (back) back(fallbackHref);
    else router.push(fallbackHref);
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const alreadyMounted = useContext(AppShellMountedContext);
  const { user, logout, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const mainRef = useMainScrollMemory(pathname);

  // عمق التنقّل جوّه التطبيق — بيزيد مع كل مسار جديد يشوفه الشِل الدائم.
  const inAppDepth = useRef(0);
  const previousPathname = useRef<string | null>(null);
  useEffect(() => {
    if (previousPathname.current !== null && previousPathname.current !== pathname) {
      inAppDepth.current += 1;
    }
    previousPathname.current = pathname;
  }, [pathname]);

  const goBack = useCallback(
    (fallbackHref: string) => {
      if (inAppDepth.current > 0) {
        inAppDepth.current -= 1;
        router.back();
        return;
      }
      router.push(fallbackHref);
    },
    [router],
  );

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
  const activeNavigation = visibleGroups
    .flatMap((group) => group.items.map((item) => ({ group: group.label, item })))
    .sort((a, b) => b.item.href.length - a.item.href.length)
    .find(({ item }) => item.href === '/' ? pathname === '/' : pathname.startsWith(item.href));

  // نسخة متداخلة (صفحة لسه بتلفّ محتواها بـ<AppShell>) — الشِل الحقيقي متركّب في الـlayout فوق،
  // فبنعدّي المحتوى زي ما هو بدل ما نرسم شريط جانبي تاني.
  if (alreadyMounted) return <>{children}</>;
  // شاشة الدخول من غير شِل — مفيش قايمة جانبية قبل تسجيل الدخول.
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;

  return (
    <AppShellMountedContext.Provider value={true}>
    <AdminBackContext.Provider value={goBack}>
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-72 shrink-0 flex-col border-s border-border/70 bg-card/85 shadow-[-18px_0_45px_-38px_oklch(0.2_0.05_255_/_55%)] backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-base font-bold text-primary-foreground shadow-md shadow-primary/20">
            ص
          </div>
          <div>
            <span className="block font-semibold">أسطى</span>
            <span className="block text-[11px] text-muted-foreground">لوحة الإدارة والعمليات</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
          {visibleGroups.map((group) => (
            <div key={group.label || 'root'}>
              {group.label && (
                <div className="px-3 pb-1.5 text-[11px] font-semibold text-muted-foreground/80">{group.label}</div>
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
                        'group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-foreground/75 transition-all hover:bg-accent/70 hover:text-accent-foreground',
                        isActive && 'bg-primary text-primary-foreground font-medium shadow-sm shadow-primary/20 hover:bg-primary hover:text-primary-foreground',
                      )}
                    >
                      <Icon className={cn('size-4 shrink-0 transition-transform group-hover:scale-105', isActive && 'text-primary-foreground')} />
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
        <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
          <div>© الصانع جروب</div>
          <div className="mt-1 text-muted-foreground/60">قواعد الاستخدام (قريبًا)</div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between border-b border-border/60 bg-card/75 px-6 py-3 backdrop-blur-xl">
          <div>
            {activeNavigation?.group && <p className="text-[11px] text-muted-foreground">{activeNavigation.group}</p>}
            <p className="text-sm font-semibold">{activeNavigation?.item.label ?? 'لوحة الإدارة'}</p>
          </div>
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
        {/* حاوية الـscroll الحقيقية — لازم تكون هنا مش على المستند، وإلا الشريط الجانبي
            بيتحرّك مع المحتوى وبيضيع مكانه (نفس الشكوى في §63.ب4). */}
        <main ref={mainRef} className="relative flex-1 overflow-y-auto p-5 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
    </AdminBackContext.Provider>
    </AppShellMountedContext.Provider>
  );
}
