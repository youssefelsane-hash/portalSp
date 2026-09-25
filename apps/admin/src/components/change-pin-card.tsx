'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ErrorNotice } from '@/components/notice';
import { PinInput } from '@/components/pin-input';
import { localPinError } from '@/lib/pin-policy';

/**
 * **تعيين/تغيير رمز الدخول للأدمن** (ADR-0109).
 *
 * الرمز عامل أول بس — الـPasskey (ADR-0011) فوقه زي ما هو بلا أي تغيير. تغيير الرمز **مايلمسش**
 * الـPasskeys ولا الجلسات.
 *
 * لو الحساب مالوش رمز (أدمن قديم من قبل التبديل)، خانة «الرمز الحالي» بتختفي والكارت بيشرح ليه
 * لازم يحطه دلوقتي: من غيره الحساب مالوش **أي** credential، فأول ما الجلسة تنتهي يبقى مقفول
 * برّه اللوحة ومحتاج أدمن تاني يعمل له reset.
 */
export function ChangePinCard() {
  const { user, setPin } = useAuth();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `!== false` مش `=== true`: الحقل اختياري في النوع، و«مش موجود» معناه نسخة API أقدم.
  const hasPin = user?.pin_set !== false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pinError = localPinError(newPin);
    if (pinError) {
      setError(pinError);
      return;
    }
    if (confirmPin !== newPin) {
      setError('الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await setPin(newPin, hasPin ? currentPin : undefined);
      toast.success(hasPin ? 'رمز الدخول اتغيّر' : 'رمز الدخول اتحفظ');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4" /> رمز الدخول
        </CardTitle>
        <CardDescription>
          {hasPin
            ? 'الرمز اللي بتدخل بيه على اللوحة. الـPasskey فوقه زي ما هو — تغيير الرمز مايلمسهوش ولا بيقفل جلساتك.'
            : 'حسابك لسه مالوش رمز دخول. من غيره مش هتقدر ترجع للوحة لو سجّلت خروج أو انتهت جلستك — هتحتاج أدمن تاني يعمل لك استرجاع.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-xs flex-col gap-4">
          {hasPin && (
            <PinInput id="current-pin" label="الرمز الحالي" value={currentPin} onChange={setCurrentPin} allowLegacy />
          )}
          <PinInput id="new-pin" label="رمز جديد (6 أرقام)" value={newPin} onChange={setNewPin} />
          <PinInput id="confirm-pin" label="أكّد الرمز" value={confirmPin} onChange={setConfirmPin} />
          {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
          <Button type="submit" data-testid="save-pin" disabled={busy}>
            {busy ? 'جاري الحفظ…' : hasPin ? 'غيّر الرمز' : 'احفظ الرمز'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
