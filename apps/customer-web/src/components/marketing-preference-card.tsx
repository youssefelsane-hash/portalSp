'use client';

import { useEffect, useState } from 'react';
import { fetchMarketingPreference, setMarketingOptOut } from '@/lib/campaigns';
import { useAuth } from '@/lib/auth-context';

/**
 * **إيقاف الرسائل التسويقية** (ADR-0046 §6).
 *
 * كان موجود في تطبيق العميل بس (`notification_preferences_screen.dart`) ومفيش أي مقابل له في
 * الموقع — يعني عميل بيستخدم الويب **مالوش أي طريقة** يوقف الإعلانات، وهو حق مش ميزة.
 *
 * الصياغة مقصودة: الزرار بيتكلم عن «العروض والتذكيرات» **مش** عن الإشعارات كلها، لأن
 * الاتنين مفصولين في الباك-إند عن قصد — العميل يقفل الإعلانات ويفضل شايف «الفني في الطريق».
 */
export function MarketingPreferenceCard() {
  const { authedFetch, isAuthenticated } = useAuth();
  const [optOut, setOptOut] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMarketingPreference(authedFetch)
      .then((pref) => setOptOut(pref.marketing_opt_out))
      .catch(() => setError('مقدرناش نحمّل الإعداد ده دلوقتي'));
  }, [authedFetch, isAuthenticated]);

  if (!isAuthenticated || optOut === null) {
    return error ? <p className="mb-4 text-sm text-danger">{error}</p> : null;
  }

  async function toggle() {
    const next = !optOut;
    setSaving(true);
    setError(null);
    // تحديث متفائل: الزرار بيتحرك فورًا، وبيرجع مكانه لو السيرفر رفض — الانتظار على نداء شبكة
    // في مفتاح بسيط زي ده بيحسّه المستخدم إن الزرار «مش شغال».
    setOptOut(next);
    try {
      const saved = await setMarketingOptOut(authedFetch, next);
      setOptOut(saved.marketing_opt_out);
    } catch {
      setOptOut(!next);
      setError('مقدرناش نحفظ التغيير — حاول تاني');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-border bg-surface p-4" data-testid="marketing-preference">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">عروض وتذكيرات أسطى</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {optOut
              ? 'موقوفة دلوقتي — مش هتوصلك أي عروض أو تذكيرات بخدمات. إشعارات طلباتك بتفضل شغّالة زي ما هي.'
              : 'بتوصلك عروض وتذكيرات بالخدمات اللي تهمّك. إيقافها مش بيأثر على إشعارات طلباتك.'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          data-testid="marketing-preference-toggle"
          className="min-h-11 shrink-0 rounded-xl border border-border px-4 text-sm font-medium transition-colors duration-150 hover:bg-muted/10 disabled:opacity-60"
        >
          {saving ? 'جاري الحفظ…' : optOut ? 'فعّلها' : 'أوقفها'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
