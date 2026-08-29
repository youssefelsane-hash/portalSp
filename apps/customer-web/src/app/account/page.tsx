'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/**
 * مركز "حسابي" (docs/08 §101) — مطابق لشاشة الحساب في تطبيق العميل بندًا ببند.
 *
 * الفجوة اللي اتقفلت: الويب كان بيعرض الاسم والتليفون والإيميل **وبس**، بينما التطبيق فيه ١٣ بند —
 * يعني عميل بيستخدم الويب مكانش يقدر يشوف محفظته ولا ضماناته ولا شكاويه ولا يوقف حجز متكرر، رغم
 * إن كل الـendpoints دي شغّالة في الباك-إند من زمان.
 */
const ACCOUNT_SECTIONS: { href: string; label: string; description: string }[] = [
  { href: '/orders', label: 'طلباتي', description: 'كل طلباتك الحالية والسابقة' },
  { href: '/account/wallet', label: 'محفظتي', description: 'رصيدك وكل الحركات المالية' },
  { href: '/account/addresses', label: 'عناويني', description: 'العناوين المحفوظة للحجز السريع' },
  { href: '/account/favorites', label: 'المفضّلة', description: 'الفنيين اللي حفظتهم' },
  { href: '/account/payment-methods', label: 'وسائل الدفع المحفوظة', description: 'الكروت المحفوظة' },
  { href: '/account/loyalty', label: 'نقاط الولاء', description: 'رصيد نقاطك وسجل الكسب' },
  { href: '/account/projects', label: 'مشاريعي', description: 'المشاريع الكبيرة ومراحلها' },
  { href: '/account/recurring', label: 'الحجوزات المتكررة', description: 'الخدمات اللي بتتكرر تلقائيًا' },
  { href: '/account/warranties', label: 'ضماناتي', description: 'الضمانات السارية على طلباتك' },
  { href: '/account/referrals', label: 'رشّح صحابك', description: 'كود الترشيح ومكافآتك' },
  { href: '/account/complaints', label: 'شكاويّي', description: 'الشكاوى المفتوحة والمقفولة' },
  { href: '/account/notifications', label: 'الإشعارات', description: 'كل الإشعارات اللي وصلتك' },
];

export default function AccountPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login?next=/account');
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="h-40 animate-pulse rounded-xl bg-surface-variant" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">حسابي</h1>
      <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex justify-between">
          <span className="text-muted">الاسم</span>
          <span className="font-medium">{user.full_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">رقم الموبايل</span>
          <span dir="ltr" className="font-medium">
            {user.phone_number}
          </span>
        </div>
        {user.email && (
          <div className="flex justify-between">
            <span className="text-muted">البريد الإلكتروني</span>
            <span dir="ltr" className="font-medium">
              {user.email}
            </span>
          </div>
        )}
      </div>
      <nav className="mt-6 grid gap-2 sm:grid-cols-2">
        {ACCOUNT_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-xl border border-border bg-surface p-4 transition hover:border-primary"
          >
            <p className="font-medium">{section.label}</p>
            <p className="mt-0.5 text-sm text-muted">{section.description}</p>
          </Link>
        ))}
      </nav>

      <div className="mt-8 space-y-2 rounded-xl border border-border bg-surface p-5 text-sm">
        <p className="font-medium">الحساب والخصوصية</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal/terms" className="text-muted underline-offset-4 hover:underline">
            شروط الاستخدام
          </Link>
          <Link href="/legal/privacy" className="text-muted underline-offset-4 hover:underline">
            سياسة الخصوصية
          </Link>
          <Link href="/legal/account-deletion" className="text-danger underline-offset-4 hover:underline">
            حذف الحساب
          </Link>
        </div>
      </div>

      <button
        onClick={async () => {
          await logout();
          router.push('/');
        }}
        className="mt-6 w-full rounded-lg border border-danger py-3 font-medium text-danger hover:bg-danger/5"
      >
        تسجيل الخروج
      </button>
    </div>
  );
}
