'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { isMfaRequiredResponse, type MfaCeremony } from '@baytak/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// useSearchParams() محتاج Suspense boundary وقت الـ static prerendering — بدونها next build
// بيفشل على /login (راجع: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type Step = 'phone' | 'otp' | 'mfa' | 'recovery';

function LoginForm() {
  const { requestOtp, verifyOtp, verifyRecoveryCode, enrollPasskey, authenticateWithPasskey } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ADR-0011 — الحساب ده High-Privilege ومحتاج Passkey. mfaSessionToken محدود العمر (10 دقايق)
  // وبيتستهلك مرة واحدة جوّه registration/authentication verify.
  const [mfaSessionToken, setMfaSessionToken] = useState<string | null>(null);
  const [ceremony, setCeremony] = useState<MfaCeremony | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodesAcknowledged, setRecoveryCodesAcknowledged] = useState(false);

  function goToApp() {
    router.push(searchParams.get('next') ?? '/');
  }

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await requestOtp(phoneNumber, 'login');
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await verifyOtp(phoneNumber, otpCode);
      if (isMfaRequiredResponse(result)) {
        setMfaSessionToken(result.mfa_session_token);
        setCeremony(result.ceremony);
        setStep('mfa');
        return;
      }
      goToApp();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await verifyRecoveryCode(phoneNumber, otpCode, recoveryCode);
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
          <CardTitle className="text-xl">تسجيل الدخول للوحة الإدارة</CardTitle>
          <CardDescription>
            {step === 'phone' && 'ادخل رقم موبايلك عشان نبعتلك كود التحقق'}
            {step === 'otp' && `اتبعت كود لـ ${phoneNumber}`}
            {step === 'mfa' && ceremony === 'registration' && 'الحساب ده محتاج تسجيل Passkey (بصمة/Face ID/مفتاح أمان) قبل ما تكمل'}
            {step === 'mfa' && ceremony === 'authentication' && 'أكّد هويتك بالـPasskey المسجّل قبل كده'}
            {step === 'recovery' && 'ادخل كود الاسترجاع اللي اتحفظ وقت تسجيل الـPasskey'}
          </CardDescription>
        </CardHeader>

        {step === 'phone' && (
          <form onSubmit={handleRequestOtp}>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone_number">رقم الموبايل</Label>
                <Input
                  id="phone_number"
                  type="tel"
                  placeholder="+201001234567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                  dir="ltr"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="pt-6">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'جاري الإرسال…' : 'ابعت كود التحقق'}
              </Button>
            </CardFooter>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp}>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="otp_code">كود التحقق (6 أرقام)</Label>
                <Input
                  id="otp_code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  dir="ltr"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4 text-start"
                onClick={() => {
                  setStep('phone');
                  setOtpCode('');
                  setError(null);
                }}
              >
                رقم موبايل غلط؟ رجّع خطوة
              </button>
            </CardContent>
            <CardFooter className="pt-6">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'جاري التحقق…' : 'دخول'}
              </Button>
            </CardFooter>
          </form>
        )}

        {step === 'mfa' && (
          <>
            <CardContent className="flex flex-col gap-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery_code">كود الاسترجاع</Label>
                <Input
                  id="recovery_code"
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
              {error && <p className="text-sm text-destructive">{error}</p>}
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
