'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { PinField, localPinError } from '@/components/pin-field';

/**
 * **تسجيل الدخول — رقم موبايل + رمز دخول** (ADR-0109).
 *
 * الصفحة كانت خطوتين لأن الخطوة الأولى كانت **لازمة**: نداء `otp/request` يبعت SMS وينتظر الرد.
 * دلوقتي مفيش حاجة تتبعت، فالخطوتين اتحوّلوا لفورم **واحد** — الرقم والرمز مع بعض ودوسة واحدة.
 * ده أقصر مسار دخول ممكن، وكان مستحيل مع الـOTP.
 */
function LoginForm() {
  const router = useRouter();
  const { loginWithPin } = useAuth();
  const [phone, setPhone] = useState(useSearchParams().get('phone') ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * **محاولات فاشلة في الصفحة دي — عدّاد محلي بالكامل.**
   *
   * السيرفر **مابيقولش** إن الحساب اتقفل: رسالة أو كود حالة مختلف للحساب المقفول مستحيل يتقال
   * إلا لحساب **موجود**، فبيبقى تعداد حسابات مؤكّد (اتقاس فعليًا: مسجّل ⇒ 429، مش مسجّل ⇒ 401).
   * العدّاد ده عن محاولات المتصفح ده، فمالوش أي علاقة بحالة الحساب على السيرفر.
   */
  const [failedAttempts, setFailedAttempts] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localError = localPinError(pin, { requireStrong: false });
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await loginWithPin(phone, pin);
      router.push('/');
    } catch (err) {
      // الخانة بتتفضّى: الرمز اللي اترفض مش هينفع تاني، وسيبانه مكتوب بيخلي المستخدم يدوس
      // «دخول» على نفس الرمز الغلط ويحرق محاولة من الخمسة بلا داعي.
      setPin('');
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setFailedAttempts((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-bold">تسجيل الدخول</h1>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-muted">رقم الموبايل</span>
          <input
            id="login-phone"
            data-testid="login-phone"
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+2010xxxxxxxx"
            dir="ltr"
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left outline-none focus:border-primary"
          />
        </label>

        <PinField
          id="login-pin"
          label="رمز الدخول"
          value={pin}
          onChange={setPin}
          autoComplete="current-password"
        />

        {/*
          بعد ٥ محاولات (نفس رصيد `PIN_MAX_ATTEMPTS` في الباك-إند) الحساب بيبقى مقفول مؤقتًا
          فعلاً — والسيرفر مابيقولش، فبنقوله إحنا من عندنا.
        */}
        {failedAttempts >= 5 && (
          <p className="text-sm text-muted" data-testid="login-too-many-attempts">
            جرّبت كتير — الحساب بيتقفل مؤقتًا بعد محاولات غلط متتالية. استنى شوية وجرّب تاني، أو
            استخدم «نسيت رمز الدخول؟».
          </p>
        )}
        {error && (
          <div className="text-sm text-danger" data-testid="login-error">
            <p>{error}</p>
            {/*
              **بيتعرض على كل فشل دخول بلا استثناء.** الرد الجديد مايفرّقش بين «رقم مش مسجّل»
              و«رمز غلط» (نفس الرسالة بالحرف — منع تعداد الحسابات، ADR-0109 §5)، فربط الاقتراح
              بالسبب بقى مستحيل. عرضه دايمًا مايسرّبش حاجة لأنه مستقل تمامًا عن وجود الحساب.
            */}
            <Link
              href={`/register?phone=${encodeURIComponent(phone)}`}
              data-testid="login-suggest-register"
              className="mt-1 inline-block text-primary hover:underline"
            >
              معندكش حساب؟ سجّل بنفس الرقم
            </Link>
          </div>
        )}

        <button
          type="submit"
          data-testid="login-submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري الدخول...' : 'دخول'}
        </button>
      </form>

      {/*
        **المخرج الوحيد لمستخدم نسي رمزه** (ADR-0109 §6-ب) — مفيش SMS بعد التبديل، فالاسترجاع
        بيمرّ على الدعم. لازم يبقى ظاهر على شاشة الدخول نفسها، وإلا المستخدم اللي محتاجه مش
        هيعرف إنه موجود أصلاً.
      */}
      <p className="mt-4 text-center text-sm">
        <Link
          href={`/pin-reset?phone=${encodeURIComponent(phone)}`}
          data-testid="login-forgot-pin"
          className="text-muted underline-offset-4 hover:text-primary hover:underline"
        >
          نسيت رمز الدخول؟
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-muted">
        مستخدم جديد؟{' '}
        <Link href="/register" className="text-primary hover:underline">
          سجّل حساب
        </Link>
      </p>
    </div>
  );
}

// `useSearchParams()` محتاج Suspense boundary وقت الـstatic prerendering، وإلا `next build`
// بيفشل على الصفحة دي.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
