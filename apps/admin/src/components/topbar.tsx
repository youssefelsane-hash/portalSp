'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

export function Topbar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <span className="font-semibold">لوحة إدارة baytak</span>
      <div className="flex items-center gap-4">
        {user && <span className="text-sm text-muted-foreground">{user.full_name}</span>}
        <Button variant="outline" size="sm" onClick={handleLogout}>
          تسجيل الخروج
        </Button>
      </div>
    </header>
  );
}
