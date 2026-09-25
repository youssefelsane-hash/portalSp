'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { isMfaRequiredResponse, type MfaCeremony } from '@baytak/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/notice';

// useSearchParams() محتاج Suspense boundary وقت الـ static prerendering — بدونها next build
// بيفشل على /login (راجع: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
/**
 * **ADR-0109**: خطوة `'otp'` اتشالت. كانت لازمة لأن الخطوة اللي قبلها بتبعت SMS وتستنى؛ دلوقتي
 * الرقم والرمز في فورم واحد، فالدخول بقى خطوة واحدة والـMFA (خطوتين `'mfa'`/`'recovery'`) زي
 * ما هو بالحرف فوقه.
 */
type Step = 'credentials' | 'mfa' | 'recovery';

function LoginForm() {
  const { loginWithPin, verifyRecoveryCode, enrollPasskey, authenticateWithPasskey } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // `activated=1` جاي من `/activate` بعد نجاح التفعيل — رسالة تطمين بس، مالهاش أي أثر أمني.
  const justActivated = searchParams.get('activated') === '1';
  const [step, setStep] = useState<Step>('credentials');
  // الرقم بيتعبّى من `?phone=` اللي `/activate` بيبعته — الموظف كتبه للتو، فطلبه تاني احتكاك
  // بلا داعي. القيمة الابتدائية بس: بعد كده الخانة ملك المستخدم.
  const [phoneNumber, setPhoneNumber] = useState(() => searchParams.get('phone') ?? '');
  const [pin, setPin] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * **محاولات فاشلة في الصفحة دي — عدّاد محلي بالكامل.** السيرفر مابيقولش إن الحساب اتقفل، لأن
   * رسالة/كود حالة مختلف للحساب المقفول مستحيل يتقال إلا لحساب **موجود** ⇒ تعداد حسابات مؤكّد.
   */
  const [failedAttempts, setFailedAttempts] = useState(0);

  // ADR-0011 — الحساب ده High-Privilege ومحتاج Passkey. mfaSessionToken محدود العمر (10 دقايق)
  // وبيتستهلك مرة واحدة جوّه registration/authentication verify.
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [ceremony, setCeremony] = useState<MfaCeremony | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodesAcknowledged, setRecoveryCodesAcknowledged] = useState(false);

  function goToApp() {
    router.push(searchParams.get('next') ?? '/');
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await loginWithPin(phoneNumber, pin);
      if (isMfaRequiredResponse(result)) {
        setMfaSessionToken(result.mfa_session_token);
        setCeremony(result.ceremony);
        setStep('mfa');
        return;
      }
      goToApp();
    } catch (err) {
      // الخانة بتتفضّى: الرمز اللي اترفض مش هينفع تاني، وسيبانه مكتوب بيحرق محاولة من الخمسة.
      setPin('');
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setFailedAttempts((n) => n + 1);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await verifyRecoveryCode(phoneNumber, pin, recoveryCode);
      // استرجاع MFA دايمًا بيرجع ceremony=registration (كل الـPasskeys القديمة اتمسحت، لازم
      // Passkey جديد كليًا — راجع auth.service.ts recoveryLogin()).
      setMfaSessionToken(result.mfa_session_token);
      setCeremony(result.ceremony);
      setStep('mfa');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'كود الاسترجاع غلط أو حصل خطأ');
    } finally {
      setIsSubmitting(false);
    }
  }

  // لازم تتنادى مباشرة من onClick بلا أي await قبلها — WebAuthn prompt محتاج user gesture حديث.
  async function handleMfaAction() {
    if (!mfaSessionToken) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (ceremony === 'registration') {
        const codes = await enrollPasskey(mfaSessionToken);
        if (codes && codes.length > 0) {
          setRecoveryCodes(codes);
          return; // منستناش goToApp() لحد ما المستخدم يقفل حوار أكواد الاسترجاع
        }
        goToApp();
      } else {
        await authenticateWithPasskey(mfaSessionToken);
        goToApp();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تأكيد الـPasskey — اتأكد إن جهازك بيدعم بصمة/Face ID/مفتاح أمان');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-3 flex items-center gap-3" aria-label="OSTA">
            {/* أصل static مقصود هنا: صفحة الدخول لازم تفضل متاحة حتى لو الـAPI واقع. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-11 rounded-xl bg-[#fff8f2] p-1.5" />
            <div>
              <span className="block text-lg font-bold tracking-[0.12em]" dir="ltr">
                OSTA
              </span>
              <span className="block text-xs text-muted-foreground">لوحة الإدارة والعمليات</span>
            </div>
          </div>
          <CardTitle className="text-xl">تسجيل الدخول للوحة الإدارة</CardTitle>
          <CardDescription>
            {step === 'credentials' &&
              (justActivated
                ? 'الحساب اتفعّل — ادخل برمز الدخول اللي اخترته'
                : 'ادخل رقم موبايلك ورمز الدخول بتاعك')}
            {step === 'mfa' && ceremony === 'registration' && 'الحساب ده محتاج تسجيل Passkey (بصمة/Face ID/مفتاح أمان) قبل ما تكمل'}
            {step === 'mfa' && ceremony === 'authentication' && 'أكّد هويتك بالـPasskey المسجّل قبل كده'}
            {step === 'recovery' && 'ادخل رمز دخولك مع كود الاسترجاع اللي اتحفظ وقت تسجيل الـPasskey'}
          </CardDescription>
        </CardHeader>

        {step === 'credentials' && (
          <form onSubmit={handleLogin}>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone_number">رقم الموبايل</Label>
                <Input
                  id="phone_number"
                  data-testid="login-phone"
                  type="tel"
                  placeholder="+201001234567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                  dir="ltr"
                  autoComplete="tel"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pin">رمز الدخول</Label>
                {/*
                  `type="password"` مقصود: الرمز **دائم** مش كود بيموت بعد دقايق، واللوحة دي
                  بتتفتح في مكاتب — حد واقف جنبك مايقراهوش. وبلا `autocomplete="one-time-code"`
                  لأن ده مش كود من SMS.
                */}
                <Input
                  id="pin"
                  data-testid="login-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  required
                  minLength={4}
                  dir="ltr"
                  autoComplete="current-password"
                />
              </div>
              {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
              {failedAttempts >= 5 && (
                <p className="text-sm text-muted-foreground" data-testid="login-too-many-attempts">
                  جرّبت كتير — الحساب بيتقفل مؤقتًا بعد محاولات غلط متتالية. استنى شوية وجرّب تاني،
                  أو كلّم أدمن تاني يعمل لك استرجاع.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3 pt-6">
              <Button type="submit" data-testid="login-submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'جاري الدخول…' : 'دخول'}
              </Button>
              {/* **المدخل اللي كان ناقص** (ADR-0111): الموظف الجديد بياخد كود تنشيط من الـSuper
                  Admin، وقبل الرابط ده مكانش فيه أي مكان في اللوحة يستهلكه فيه — فكان لازم يروح
                  موقع العملاء يفعّل حساب إداري. ونفس الشاشة بتخدم اللي نسي رمزه كمان: الفرق بين
                  الحالتين هو **مين أصدر الكود** بس، مش المسار. */}
              <Link
                href="/activate"
                className="text-sm text-muted-foreground hover:underline"
                data-testid="login-activate-link"
              >
                أول مرة تدخل أو نسيت رمز الدخول؟ فعّل حسابك بكود التنشيط
              </Link>
            </CardFooter>
          </form>
        )}

        {step === 'mfa' && (
          <>
            <CardContent className="flex flex-col gap-4">
              {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
              {ceremony === 'authentication' && (
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline underline-offset-4 text-start"
                  onClick={() => {
                    setStep('recovery');
                    setError(null);
                    setRecoveryCode('');
                  }}
                >
                  الجهاز اللي فيه الـPasskey مش معاك؟ استخدم كود استرجاع
                </button>
              )}
            </CardContent>
            <CardFooter className="pt-2">
              <Button type="button" className="w-full" disabled={isSubmitting} onClick={() => void handleMfaAction()}>
                {isSubmitting ? 'جاري التأكيد…' : ceremony === 'registration' ? 'سجّل Passkey دلوقتي' : 'تأكيد بـ Passkey'}
              </Button>
            </CardFooter>
          </>
        )}

        {step === 'recovery' && (
          <form onSubmit={handleRecoverySubmit}>
            <CardContent className="flex flex-col gap-4">
              {/*
                **عاملين مستقلين لازمين مع بعض (ADR-0011 §6)**: رمز الدخول + كود الاسترجاع.
                الرمز بيتطلب تاني هنا عمدًا — المستخدم ممكن يكون وصل للخطوة دي من شاشة الـMFA
                بعد ما دخل رمزه، لكن الخانة بتتفضّى بعد أي فشل، والاسترجاع بيمسح كل الـPasskeys
                فمينفعش يمشي على قيمة قديمة في الحالة.
              */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery_pin">رمز الدخول</Label>
                <Input
                  id="recovery_pin"
                  data-testid="recovery-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  required
                  minLength={4}
                  dir="ltr"
                  autoComplete="current-password"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery_code">كود الاسترجاع</Label>
                <Input
                  id="recovery_code"
                  data-testid="recovery-code"
                  placeholder="XXXX-XXXX-XXXX"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  required
                  dir="ltr"
                  autoFocus
                />
              </div>
              <p className="text-sm text-muted-foreground">
                استخدام كود الاسترجاع هيمسح كل الـPasskeys القديمة وهيقفل كل جلساتك الحالية —
                هتحتاج تسجّل Passkey جديد فورًا بعد كده.
              </p>
              {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4 text-start"
                onClick={() => {
                  setStep('mfa');
                  setError(null);
                }}
              >
                رجوع
              </button>
            </CardContent>
            <CardFooter className="pt-6">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'جاري التحقق…' : 'تأكيد كود الاسترجاع'}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>

      <Dialog open={recoveryCodes !== null}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>احفظ أكواد الاسترجاع دي</DialogTitle>
            <DialogDescription>
              دي بتظهر مرة واحدة بس. لو فقدت جهاز الـPasskey، هتحتاج واحد منهم عشان ترجع لحسابك.
              احفظهم في مكان آمن دلوقتي (مدير كلمات سر، ورقة في مكان آمن) — مش هتقدر تشوفهم تاني بعد ما تقفل الرسالة دي.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-4 font-mono text-sm" dir="ltr">
            {recoveryCodes?.map((code) => <span key={code}>{code}</span>)}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ack"
              type="checkbox"
              checked={recoveryCodesAcknowledged}
              onChange={(e) => setRecoveryCodesAcknowledged(e.target.checked)}
            />
            <Label htmlFor="ack" className="text-sm font-normal">
              احفظت الأكواد دي في مكان آمن
            </Label>
          </div>
          <DialogFooter>
            <Button disabled={!recoveryCodesAcknowledged} onClick={() => goToApp()}>
              كمّل للوحة الإدارة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
