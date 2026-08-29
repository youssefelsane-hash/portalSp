'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * غلاف موحّد لكل أقسام "حسابي" على الويب (docs/08 §101).
 *
 * كل قسم كان هيكرر نفس أربع حاجات: تحويل الزائر لتسجيل الدخول برابط رجوع، حالة تحميل، حالة
 * فاضية، وحالة خطأ. تجميعها هنا معناه إن أي قسم جديد بيبقى **دالة جلب + دالة عرض** وبس، وإن
 * سلوك الحالات الأربعة واحد في كل الأقسام — مش كل صفحة بتخترع شكل مختلف.
 */
export function AccountSection<T>({
  title,
  backHref = '/account',
  load,
  emptyText,
  children,
  headerExtra,
}: {
  title: string;
  backHref?: string;
  load: (authedFetch: AuthedFetch) => Promise<T>;
  /** لو اتبعت، بيتعرض لما الجلب يرجّع مصفوفة فاضية. */
  emptyText?: string;
  children: (data: T, reload: () => void) => ReactNode;
  headerExtra?: ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!isAuthenticated) return;
    // حارس ضد تحديث مكوّن اتشال بالفعل (تنقّل سريع قبل ما الجلب يخلص) — الأثر بيتلغي والنتيجة
    // المتأخرة بتتجاهَل بدل ما ترمي تحذير React.
    let cancelled = false;
    const applyData = (result: T) => {
      if (cancelled) return;
      setData(result);
      // مسح الخطأ هنا (مش قبل الجلب) عشان إعادة المحاولة الفاشلة تسيب رسالة الخطأ ظاهرة
      // بدل ما تمسحها وتسيب الشاشة فاضية بلا أي تفسير.
      setError(null);
    };
    const applyError = (err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'مقدرناش نحمّل البيانات');
    };
    load(authedFetch).then(applyData).catch(applyError);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading, reloadToken]);

  const isEmpty = emptyText !== undefined && Array.isArray(data) && data.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-muted underline-offset-4 hover:underline">
            ← رجوع لحسابي
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        </div>
        {headerExtra}
      </div>

      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-danger">{error}</p>}

      {!error && data === null && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-variant" />
          ))}
        </div>
      )}

      {!error && data !== null && isEmpty && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-muted">{emptyText}</div>
      )}

      {!error && data !== null && !isEmpty && children(data, () => setReloadToken((t) => t + 1))}
    </div>
  );
}

/** كارت صف موحّد — بيمنع كل صفحة تخترع شكل مختلف لنفس المعنى. */
export function AccountRow({
  title,
  subtitle,
  trailing,
  href,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-sm">{trailing}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}
