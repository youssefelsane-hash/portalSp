'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PhoneField } from '@/components/phone-field';
import { ApiError } from '@/lib/api-client';
import { ApiEnvelope } from '@/lib/api-types';
import { PinField, localPinError } from '@/components/pin-field';
import { SupportContactLinks } from '@/components/support-contact-links';

/**
 * **استرجاع رمز الدخول** (ADR-0109 §6-ب).
 *
 * الصفحة دي هي **المخرج الوحيد** لمستخدم نسي رمزه وهو مش داخل. مفيش SMS بعد التبديل، فالمسار:
 * العميل بيكلّم الدعم ← الدعم بيتأكد من هويته ويصدر كود ← بيقوله الكود في المكالمة ← العميل
 * بيكتبه هنا **ويختار رمزه بنفسه**.
 *
 * الأدمن عمره ما يعرف الرمز الجديد — ده مقصود (ADR-0109 §6-ب): لو الأدمن اختاره، يبقى فيه بني
 * آدم تاني يعرف سر دخول العميل.
 */
function PinResetForm() {
  const router = useRouter();
  const [phone, setPhone] = useState(useSearchParams().get('phone') ?? '');
  const [resetCode, setResetCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localError = localPinError(pin, { requireStrong: true });
    if (localError) {
      setError(localError);
      return;
    }
    if (confirmPin !== pin) {
      setError('الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/pin/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, reset_code: resetCode, pin }),
      });
      const envelope = (await res.json()) as ApiEnvelope<unknown>;
      if (!res.ok || !envelope.success) {
        throw new ApiError(
          envelope.error?.code ?? 'UNKNOWN',
          envelope.error?.message ?? 'حصل خطأ غير متوقع',
          res.status,
        );
      }
      // **مفيش جلسة بترجع هنا** — العميل بيدخل بالرمز الجديد من شاشة الدخول العادية.
      router.push(`/login?phone=${encodeURIComponent(phone)}`);
    } catch (err) {
      setResetCode('');
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-2 text-center text-2xl font-bold">استرجاع رمز الدخول</h1>
      <p className="mb-3 text-center text-sm text-muted">
        كلّم خدمة العملاء، وهيدّوك كود استرجاع في المكالمة. اكتبه هنا واختار رمز دخول جديد.
      </p>
      {/* **بيانات الدعم لازم تبان هنا** (ADR-0111 §6): الصفحة بتقول «كلّم خدمة العملاء»، والعميل
          المقفول برّه حسابه مايقدرش يوصل لصفحة الدعم جوّه حسابه عشان يجيب الرقم — فكانت بتطلب
          منه حاجة مفيش طريقة يعملها. المصدر `GET /settings/support-contact` وهو عام أصلاً. */}
      <SupportContactLinks />

      <form onSubmit={submit} className="space-y-4">
        <PhoneField id="pin-reset-phone" value={phone} onChange={setPhone} autoFocus />
        <label className="block">
          <span className="mb-1 block text-sm text-muted">كود الاسترجاع (10 أرقام)</span>
          <input
            id="pin-reset-code"
            data-testid="pin-reset-code"
            inputMode="numeric"
            required
            minLength={10}
            maxLength={10}
            autoComplete="off"
            value={resetCode}
            onChange={(e) => setResetCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
            dir="ltr"
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-primary"
          />
        </label>

        <PinField
          id="pin-reset-new"
          label="رمز الدخول الجديد (6 أرقام)"
          value={pin}
          onChange={setPin}
          autoComplete="new-password"
        />
        <PinField
          id="pin-reset-confirm"
          label="أكّد الرمز"
          value={confirmPin}
          onChange={setConfirmPin}
          autoComplete="new-password"
        />

        {error && (
          <p className="text-sm text-danger" data-testid="pin-reset-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="pin-reset-submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري الحفظ...' : 'احفظ الرمز الجديد'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        فاكر رمزك؟{' '}
        <Link href="/login" className="text-primary hover:underline">
          سجّل دخول
        </Link>
      </p>
    </div>
  );
}

export default function PinResetPage() {
  return (
    <Suspense>
      <PinResetForm />
    </Suspense>
  );
}
