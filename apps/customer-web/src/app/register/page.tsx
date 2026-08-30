'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { OtpResendButton } from '@/components/otp-resend-button';

type Step = 'phone' | 'code';

function RegisterForm() {
  const router = useRouter();
  const { requestOtp, register } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(useSearchParams().get('phone') ?? '');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestOtp(phone, 'register');
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
    setBusy(true);
    try {
      await register(phone, code, fullName);
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

      {step === 'phone' ? (
        <form onSubmit={submitPhone} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">الاسم</span>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-primary"
            />
          </label>
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
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'جاري الإنشاء...' : 'إنشاء الحساب'}
          </button>
          <OtpResendButton
            disabled={busy}
            onResend={async () => {
              await requestOtp(phone, 'register');
              // الكود القديم بقى ملغي على السيرفر — تفضية الخانة بتمنع إرسال كود ميت وحرق محاولة.
              setCode('');
              setError(null);
            }}
          />
          <button type="button" onClick={() => setStep('phone')} className="w-full text-sm text-muted hover:text-primary">
            غيّر الرقم
          </button>
        </form>
      )}

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
