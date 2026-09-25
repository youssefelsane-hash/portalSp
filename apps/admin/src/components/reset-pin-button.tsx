'use client';

import { useState } from 'react';
import { KeyRound, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ResetPinResult {
  pin_cleared: boolean;
  reset_code: string;
  expires_at: string;
}

/**
 * **استرجاع رمز دخول عميل** (ADR-0109 §6-ب) — الدعم بيعمله بعد ما يتأكد من هوية العميل في مكالمة.
 *
 * بيصدّر **كود لمرة واحدة** الموظف بيقوله للعميل في نفس المكالمة، والعميل بيستهلكه ويختار رمزه
 * بنفسه. الموظف عمره ما يعرف الرمز الجديد — ده مقصود: لو الأدمن اختاره، يبقى فيه بني آدم تاني
 * يعرف سر دخول العميل.
 *
 * **الكود بيتعرض مرة واحدة بس.** بعد ما الحوار يتقفل مفيش طريقة تقراه تاني من أي مكان (متخزّن
 * مجزّأ)، فالحوار بيقفل بتأكيد صريح مش بضغطة برّه — نفس نمط أكواد استرجاع الـMFA بالظبط.
 */
export function ResetPinButton({ userId, userLabel }: { userId: string; userLabel: string }) {
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

      <Dialog open={result !== null}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>كود الاسترجاع</DialogTitle>
            <DialogDescription>
              قول الكود ده للعميل في المكالمة دلوقتي. صالح لمدة 15 دقيقة ولمرة واحدة بس، ومش
              هتقدر تشوفه تاني بعد ما تقفل الرسالة دي. العميل بيكتبه في التطبيق أو الموقع من
              «نسيت رمز الدخول؟» **ويختار رمزه بنفسه** — إنت مش هتعرفه.
            </DialogDescription>
          </DialogHeader>
          <div
            className="rounded-md bg-muted p-4 text-center font-mono text-2xl tracking-[0.3em]"
            dir="ltr"
            data-testid="reset-pin-code"
          >
            {result?.reset_code}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (result) void navigator.clipboard.writeText(result.reset_code).then(
                  () => toast.success('اتنسخ'),
                  () => toast.error('المتصفح رفض النسخ — اقرا الكود من الشاشة'),
                );
              }}
            >
              <Copy className="size-4" /> انسخ
            </Button>
            <Button onClick={() => setResult(null)}>قلت الكود للعميل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
