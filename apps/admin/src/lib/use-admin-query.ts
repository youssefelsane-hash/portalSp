'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';

/**
 * جلب بيانات لصفحات الأدمن بلا `setState` متزامن جوّه `useEffect`.
 *
 * ليه موجود (docs/08 §63.ب7): الشكل المتكرر في الأدمن كان
 * `useEffect(() => { setLoading(true); setError(null); fetch().then(setData) }, [deps])`.
 * ده بيكسر قاعدة `react-hooks/set-state-in-effect` (18 خطأ متراكم)، وكمان فيه بَقّتين حقيقيتين:
 *   1. سباق ردود (race): لو الأدمن غيّر الفلتر بسرعة، رد قديم ممكن يوصل بعد الجديد ويكتب فوقه.
 *   2. وميض: كل تغيير فلتر كان بيفضّي الجدول قبل ما البيانات الجديدة توصل.
 *
 * الحل هنا: حالة واحدة بتتخزّن **ومعاها المفتاح اللي اتجابت له**، و`loading` بيتحسب أثناء الرندر
 * بمقارنة المفتاح — مفيش `setState` في جسم الـeffect خالص، والرد القديم بيتترمي لأن مفتاحه مش
 * مطابق للحالي. البيانات القديمة بتفضل ظاهرة لحد ما الجديدة توصل (keep-previous) عشان مفيش وميض.
 *
 * @param key مفتاح الطلب (نص متغيّر بكل الفلاتر). `null` = ما تجيبش (مثلاً فلتر إجباري لسه فاضي).
 * @param fetcher الدالة اللي بتجيب فعليًا — بتتقرا من ref فمش لازم تكون مستقرة (useCallback).
 */
export function useAdminQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  errorMessage: string,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; nonce: number; data: T | null; error: string | null } | null>(null);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setResult({ key, nonce, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, nonce, data: null, error: err instanceof ApiError ? err.message : errorMessage });
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, errorMessage]);

  const fresh = result !== null && result.key === key && result.nonce === nonce;
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  if (key === null) return { data: null, loading: false, error: null, reload };
  return {
    // بنسيب آخر بيانات ظاهرة أثناء التحميل (keep-previous) — الوميض كان شكوى صريحة في §63.ب1.
    data: result?.data ?? null,
    loading: !fresh,
    error: fresh ? result.error : null,
    reload,
  };
}

/**
 * ترقيم صفحات بيرجع للصفحة 1 تلقائيًا لما الفلاتر تتغيّر — من غير `useEffect`.
 *
 * الشكل القديم كان `useEffect(() => setPage(1), [filters])`: رندر زيادة، ونداء شبكة ضايع على
 * الصفحة القديمة بالفلتر الجديد، وكسر لقاعدة `set-state-in-effect`. هنا الصفحة متخزّنة **ومعاها
 * توقيع الفلاتر**، فلو التوقيع اتغيّر بترجع 1 أثناء الرندر نفسه بلا أي أثر جانبي.
 *
 * @param filterKey توقيع نصي لكل الفلاتر اللي المفروض ترجّع الترقيم للأول.
 */
export function useFilteredPage(filterKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = useCallback((next: number) => setState({ key: filterKey, page: next }), [filterKey]);
  return [page, setPage];
}
