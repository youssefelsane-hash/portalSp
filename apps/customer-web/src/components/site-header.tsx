'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { fetchLogo } from '@/lib/settings';

// §92 — الويب منتج حقيقي مش برشور، فلازم navigation ثابت واضح لكل الشاشات الأساسية، مش بس صفحة
// هبوط. رابط واحد لكل نقطة دخول رئيسية (طلباتي/حسابي)، بلا قوائم متداخلة (§53: "Do not make
// customer navigate through 6 settings menus").
export function SiteHeader() {
  const { isAuthenticated, user, logout, isLoading } = useAuth();
  // اللوجو الحقيقي (docs/08 §84 جزء أ) — كان نص "أسطى" ثابت بس، صفر صورة لوجو خالص. لو الأدمن رفع
  // لوجو حقيقي (is_default=false) بيتعرض كصورة، وإلا نص الاسم زي ما كان (نفس فلسفة fallback
  // الـhero الموجودة أصلاً في الصفحة الرئيسية).
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchLogo()
      .then((asset) => setLogoUrl(asset.is_default ? null : asset.url))
      .catch(() => {});
  }, []);

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-40">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center text-xl font-bold text-primary">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- لوجو مُدار من الأدمن، مش أصل ثابت معروف وقت الـbuild
            <img src={logoUrl} alt="أسطى" className="h-9 w-auto" onError={() => setLogoUrl(null)} />
          ) : (
            'أسطى'
          )}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {isLoading ? null : isAuthenticated ? (
            <>
              <Link href="/orders" className="hover:text-primary">
                طلباتي
              </Link>
              <Link href="/account" className="hover:text-primary">
                {user?.full_name ?? 'حسابي'}
              </Link>
              <button onClick={() => logout()} className="text-muted hover:text-danger">
                خروج
              </button>
            </>
          ) : (
            <Link href="/login" className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90">
              تسجيل الدخول
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
