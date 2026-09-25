'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { OneTimeCodeDialog } from '@/components/one-time-code-dialog';

interface ActivationCodeResult {
  activation_code: string;
  activation_code_expires_at: string;
}

/**
 * **إعادة إصدار كود تنشيط لموظف** (ADR-0111).
 *
 * كود التنشيط عمره ١٥ دقيقة. موظف ما لحقش يستخدمه كان بيفضل **مقفول برّه الحساب تمامًا**: مفيش
 * رمز عنده، والـSMS متوقف، و`POST /auth/pin` محتاج جلسة هو مش قادر يعملها. الزرار ده هو المخرج.
 *
 * **مابيمسحش رمزه لو كان حطّه بالفعل** — بعكس «استرجاع رمز الدخول». فلو أدمن دوس بالغلط على
 * موظف شغّال عادي، الموظف مايتأثرش خالص: الرمز بيتغيّر بس لما الكود يتستهلك فعلاً.
 */
export function EmployeeActivationCodeButton({ userId, userLabel }: { userId: string; userLabel: string }) {
  const { authedFetch, hasPermission } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActivationCodeResult | null>(null);

  if (!hasPermission('employees.manage')) return null;

  async function handleReissue() {
    setBusy(true);
    try {
      // `@RequireStepUp()` على الباك-إند بيتعامل معاه `authedFetch` تلقائيًا (auth-context).
      setResult(
        await authedFetch<ActivationCodeResult>(`/admin/employees/${userId}/activation-code`, { method: 'POST' }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل إصدار كود التنشيط');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        title="كود تنشيط جديد؟"
        description={`هيطلع كود تنشيط جديد تبعته لـ${userLabel} عشان يحط رمز دخوله. الكود القديم بيبطل فورًا، ورمز الدخول الحالي (لو حطّه بالفعل) مايتأثرش. الإجراء بيتسجّل باسمك.`}
        confirmLabel="اصدر الكود"
        onConfirm={handleReissue}
        trigger={
          <Button variant="outline" size="sm" disabled={busy} data-testid="employee-activation-code-button">
            <KeyRound className="size-4" /> {busy ? 'جاري الإصدار…' : 'كود تنشيط جديد'}
          </Button>
        }
      />

      <OneTimeCodeDialog
        open={result !== null}
        title="كود تنشيط الموظف"
        code={result?.activation_code ?? null}
        testId="employee-activation-code"
        description={
          <>
            ابعت الكود ده للموظف دلوقتي. صالح ١٥ دقيقة ولمرة واحدة، ومش هتقدر تشوفه تاني بعد ما
            تقفل الرسالة دي. الموظف بيكتبه من شاشة الدخول ← «نسيت رمز الدخول؟» <b>ويختار رمزه
            بنفسه</b> — إنت مش هتعرفه.
          </>
        }
        confirmLabel="بعتّ الكود للموظف"
        onConfirm={() => setResult(null)}
      />
    </>
  );
}
