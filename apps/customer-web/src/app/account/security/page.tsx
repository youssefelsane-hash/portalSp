'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { PinField, localPinError } from '@/components/pin-field';

/**
 * **تعيين/تغيير رمز الدخول** (ADR-0109 §6-أ).
 *
 * صفحة واحدة بحالتين، والفرق بينهم هو `pin_set` في `/auth/me`:
 *  - **مالوش رمز** (مستخدم قديم من قبل التبديل): مفيش خانة «الرمز الحالي»، والنص بيشرح ليه
 *    بيتطلب منه ده أصلاً. آمن تمامًا: الجلسة قايمة بالفعل فمفيش استيلاء ممكن — وده بالظبط سبب
 *    إن المسار ده **متوثّق** مش من شاشة الدخول (الخيار التاني مرفوض صراحة في ADR-0109 §6-أ
 *    لأنه استيلاء على أي حساب لأي حد يعرف رقم تليفون).
 *  - **ليه رمز**: بيطلب الحالي قبل الجديد.
 */
export default function SecurityPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, setPin } = useAuth();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);

  // `pin_set !== false` مش `=== true`: الحقل اختياري، و«مش موجود» معناه نسخة API أقدم — في
  // الحالة دي بنتعامل معاه كأن الحساب ليه رمز بدل ما نطلب من المستخدم حاجة مالهاش لازمة.
  const hasPin = user?.pin_set !== false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localError = localPinError(newPin, { requireStrong: true });
    if (localError) {
      setError(localError);
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
      setDone(true);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="px-4 py-16 text-center text-muted">جاري التحميل…</div>;

  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-2 text-center text-2xl font-bold">
        {hasPin ? 'تغيير رمز الدخول' : 'اختار رمز دخول لحسابك'}
      </h1>
      <p className="mb-6 text-center text-sm text-muted">
        {hasPin
          ? 'الرمز اللي بتدخل بيه لو سجّلت خروج أو غيّرت جهازك.'
          : 'بقيت تدخل بالرمز ده بدل كود الرسايل — أسرع وما بيحتاجش انتظار. خزّنه في مكان تفتكره: هو اللي هيرجّعك لحسابك لو سجّلت خروج أو غيّرت جهازك.'}
      </p>

      <form onSubmit={submit} className="space-y-4">
        {hasPin && (
          <PinField
            id="security-current-pin"
            label="الرمز الحالي"
            value={currentPin}
            onChange={setCurrentPin}
            autoComplete="current-password"
          />
        )}
        <PinField
          id="security-new-pin"
          label="رمز الدخول الجديد (4–6 أرقام)"
          value={newPin}
          onChange={setNewPin}
          autoFocus={!hasPin}
          autoComplete="new-password"
        />
        <PinField
          id="security-confirm-pin"
          label="أكّد الرمز"
          value={confirmPin}
          onChange={setConfirmPin}
          autoComplete="new-password"
        />

        {error && (
          <p className="text-sm text-danger" data-testid="security-error">
            {error}
          </p>
        )}
        {done && (
          <p className="text-sm text-success" data-testid="security-done">
            تم — رمز الدخول بقى محفوظ.
          </p>
        )}

        <button
          type="submit"
          data-testid="security-submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري الحفظ...' : 'حفظ الرمز'}
        </button>
      </form>
    </div>
  );
}
