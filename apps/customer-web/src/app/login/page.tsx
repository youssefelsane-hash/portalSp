'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { OtpResendButton } from '@/components/otp-resend-button';

type Step = 'phone' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestOtp(phone, 'login');
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotRegistered(false);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VAL_001') {
        setNotRegistered(true);
      }
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-bold">تسجيل الدخول</h1>

      {step === 'phone' ? (
        <form onSubmit={submitPhone} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">رقم الموبايل</span>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2010xxxxxxxx"
              dir="ltr"
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left outline-none focus:border-primary"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'جاري الإرسال...' : 'ابعت كود التحقق'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-sm text-muted">اتبعت كود لرقم {phone}</p>
          <input
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="كود التحقق"
            dir="ltr"
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-primary"
          />
          {error && (
            <div className="text-sm text-danger">
              <p>{error}</p>
              {notRegistered && (
                <Link href={`/register?phone=${encodeURIComponent(phone)}`} className="mt-1 inline-block text-primary hover:underline">
                  سجّل حساب جديد
                </Link>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'جاري التحقق...' : 'دخول'}
          </button>
          <OtpResendButton
            disabled={busy}
            onResend={async () => {
              await requestOtp(phone, 'login');
              // الكود القديم بقى ملغي على السيرفر — تفضية الخانة بتمنع إرسال كود ميت وحرق محاولة.
              setCode('');
              setError(null);
              setNotRegistered(false);
            }}
          />
          <button type="button" onClick={() => setStep('phone')} className="w-full text-sm text-muted hover:text-primary">
            غيّر الرقم
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        مستخدم جديد؟{' '}
        <Link href="/register" className="text-primary hover:underline">
          سجّل حساب
        </Link>
      </p>
    </div>
  );
}
