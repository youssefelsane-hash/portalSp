'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

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
    <div className="mx-auto max-w-md px-4 py-16">
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
