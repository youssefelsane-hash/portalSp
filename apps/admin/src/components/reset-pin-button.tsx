'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { OneTimeCodeDialog } from '@/components/one-time-code-dialog';

interface ResetPinResult {
  pin_cleared: boolean;
  reset_code: string;
  expires_at: string;
}

/**
 * استرجاع رمز دخول عميل أو فني بعد التحقق من هويته في مكالمة.
 *
 * بيصدّر **كود لمرة واحدة** الموظف بيقوله للمستخدم في نفس المكالمة، والمستخدم بيستهلكه ويختار رمزه
 * بنفسه. الموظف عمره ما يعرف الرمز الجديد — ده مقصود: لو الأدمن اختاره، يبقى فيه بني آدم تاني
 * يعرف سر دخول المستخدم.
 *
 * **الكود بيتعرض مرة واحدة بس.** بعد ما الحوار يتقفل مفيش طريقة تقراه تاني من أي مكان (متخزّن
 * مجزّأ)، فالحوار بيقفل بتأكيد صريح مش بضغطة برّه — نفس نمط أكواد استرجاع الـMFA بالظبط.
 */
export function ResetPinButton({
  userId,
  userLabel,
  userKind = 'العميل',
}: {
  userId: string;
  userLabel: string;
  userKind?: 'العميل' | 'الفني';
}) {
  const { authedFetch, hasPermission } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetPinResult | null>(null);

  if (!hasPermission('users.reset_pin')) return null;

  async function handleReset() {
    setBusy(true);
    try {
      // الحارس `@RequireStepUp()` على الباك-إند بيتعامل معاه `authedFetch` تلقائيًا
      // (auth-context) — الصفحة مش محتاجة تعرف عن AUTH_006 خالص.
      const res = await authedFetch<ResetPinResult>(`/admin/users/${userId}/pin/reset`, { method: 'POST' });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل استرجاع رمز الدخول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        title="استرجاع رمز الدخول؟"
        description={`هيتمسح رمز دخول ${userLabel} وهتتقفل كل جلساته المفتوحة، وهيطلع كود استرجاع تقوله له في المكالمة. اتأكد من هويته الأول — الإجراء ده بيتسجّل باسمك.`}
        confirmLabel="استرجع الرمز"
        onConfirm={handleReset}
        trigger={
          <Button variant="outline" size="sm" disabled={busy} data-testid="reset-pin-button">
            <KeyRound className="size-4" /> {busy ? 'جاري الاسترجاع…' : 'استرجاع رمز الدخول'}
          </Button>
        }
      />

      <OneTimeCodeDialog
        open={result !== null}
        title="كود الاسترجاع"
        code={result?.reset_code ?? null}
        testId="reset-pin-code"
        description={
          <>
            قول الكود ده لـ{userKind} في المكالمة دلوقتي. صالح لمدة 15 دقيقة ولمرة واحدة بس، ومش هتقدر
            تشوفه تاني بعد ما تقفل الرسالة دي. {userKind} بيكتبه في {userKind === 'الفني' ? 'التطبيق' : 'التطبيق أو الموقع'} من «نسيت رمز
            الدخول؟» <b>ويختار رمزه بنفسه</b> — إنت مش هتعرفه.
          </>
        }
        confirmLabel={`قلت الكود لـ${userKind}`}
        onConfirm={() => setResult(null)}
      />

    </>
  );
}
