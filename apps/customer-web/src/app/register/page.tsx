'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PhoneField } from '@/components/phone-field';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { PinField, localPinError } from '@/components/pin-field';
import { readPendingPromoLinkCode } from '@/lib/promo-link';

/**
 * **حساب جديد — رقم موبايل + اسم + رمز دخول** (ADR-0109).
 *
 * فورم واحد بدل خطوتين: مفيش SMS بيتبعت، فمفيش سبب يخلّي المستخدم يعدّي على شاشتين.
 */
function RegisterForm() {
  const router = useRouter();
  const { registerWithPin } = useAuth();
  const [phone, setPhone] = useState(useSearchParams().get('phone') ?? '');
  const [fullName, setFullName] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localError = localPinError(pin, { requireStrong: true });
    if (localError) {
      setError(localError);
      return;
    }
    // تأكيد الرمز وقت **التسجيل بس**: غلطة كتابة هنا معناها المستخدم مقفول برّه حسابه ومحتاج
    // استرجاع من الأدمن — تكلفة عالية جدًا لخانة واحدة زيادة.
    if (pinConfirm !== pin) {
      setError('الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await registerWithPin(phone, pin, fullName, readPendingPromoLinkCode() ?? undefined);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-bold">حساب جديد</h1>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-muted">الاسم</span>
          <input
            id="register-full-name"
            data-testid="register-full-name"
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-primary"
          />
        </label>
        <PhoneField id="register-phone" value={phone} onChange={setPhone} />

        <PinField
          id="register-pin"
          label="اختار رمز دخول (6 أرقام)"
          value={pin}
          onChange={setPin}
          autoComplete="new-password"
        />
        <PinField
          id="register-pin-confirm"
          label="أكّد الرمز"
          value={pinConfirm}
          onChange={setPinConfirm}
          autoComplete="new-password"
        />

        <p className="text-xs text-muted">
          خزّن الرمز في مكان تفتكره — هو اللي هيرجّعك لحسابك لو سجّلت خروج أو غيّرت جهازك.
        </p>

        {error && (
          <p className="text-sm text-danger" data-testid="register-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="register-submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري الإنشاء...' : 'إنشاء الحساب'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        عندك حساب؟{' '}
        <Link href="/login" className="text-primary hover:underline">
          سجّل دخول
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
