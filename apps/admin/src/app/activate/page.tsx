'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { ACTIVATION_CODE_LENGTH, PIN_LENGTH, localPinError } from '@/lib/pin-policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { ErrorNotice } from '@/components/notice';
import { PinInput } from '@/components/pin-input';

/**
 * **تفعيل حساب موظف جديد** (ADR-0111).
 *
 * الـSuper Admin بيعمل الموظف فبيطلع **كود تنشيط** (١٠ أرقام، ١٥ دقيقة، لمرة واحدة) ويبعته له.
 * الشاشة دي هي المكان اللي الموظف بيستهلك فيه الكود **ويختار رمزه بنفسه** — فالأدمن عمره ما
 * يعرف رمز دخول حد (ADR-0109 §6-ب).
 *
 * ### الفجوة اللي الشاشة دي بتقفلها
 *
 * الباك-إند كان مظبوط، بس مكانش فيه أي مدخل ليه من لوحة التحكم: شاشة الدخول مافيهاش «فعّل حسابك»
 * ولا «نسيت رمز الدخول؟»، ومفيش `/activate` ولا بروكسي `redeem`. فالموظف الجديد كان لازم يروح
 * **موقع العملاء** — مسار شغّال تقنيًا وغلط تمامًا.
 *
 * ### نفس الشاشة للاسترجاع كمان
 *
 * موظف نسي رمزه بياخد كود من أدمن عنده `users.reset_pin` (نفس الميكانيزم بالظبط،
 * `issuePinSetupCode`) وبيستهلكه من هنا. فشاشة واحدة للحالتين مش اتنين — والفرق بينهم في
 * **مين أصدر الكود** بس، مش في المسار.
 */
export default function ActivateAccountPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (activationCode.length !== ACTIVATION_CODE_LENGTH) {
      setError(`كود التنشيط ${ACTIVATION_CODE_LENGTH} أرقام`);
      return;
    }
    // نفس قاعدة الباك-إند بالحرف (`localPinError`) — رحلة شبكة أقل ورسالة أسرع، والسيرفر بيفحص تاني.
    const pinError = localPinError(pin);
    if (pinError) {
      setError(pinError);
      return;
    }
    if (confirmPin !== pin) {
      setError('الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/pin/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber, reset_code: activationCode, pin }),
      });
      const envelope = (await res.json()) as { success?: boolean; error?: { code?: string; message?: string } };
      if (!res.ok || !envelope.success) {
        throw new ApiError(
          envelope.error?.code ?? 'UNKNOWN',
          envelope.error?.message ?? 'حصل خطأ غير متوقع',
          res.status,
        );
      }
      // **مفيش جلسة بترجع** — الموظف بيدخل بالرمز الجديد من شاشة الدخول، فسياسة MFA/Passkey
      // بتتفرض عليه زي أي حد تاني. الرقم بيتمرّر عشان مايكتبهوش تاني.
      router.push(`/login?phone=${encodeURIComponent(phoneNumber)}&activated=1`);
    } catch (err) {
      // **الكود بيتفضّى مش الرمز**: كود اترفض مش هينفع تاني، وسيبانه مكتوب أسرع طريقة يستهلك
      // بيها الموظف محاولاته الخمسة على السيرفر.
      setActivationCode('');
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>تفعيل الحساب</CardTitle>
            <CardDescription>
              ادخل رقم موبايلك وكود التنشيط اللي وصلك، واختار رمز دخول جديد. الكود صالح ١٥ دقيقة
              ولمرة واحدة.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone_number">رقم الموبايل</Label>
              <Input
                id="phone_number"
                data-testid="activate-phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="+201XXXXXXXXX"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="activation_code">كود التنشيط ({ACTIVATION_CODE_LENGTH} أرقام)</Label>
              <Input
                id="activation_code"
                data-testid="activate-code"
                inputMode="numeric"
                dir="ltr"
                maxLength={ACTIVATION_CODE_LENGTH}
                value={activationCode}
                onChange={(e) =>
                  setActivationCode(e.target.value.replace(/[^0-9]/g, '').slice(0, ACTIVATION_CODE_LENGTH))
                }
                required
                autoComplete="one-time-code"
              />
            </div>

            <PinInput
              id="activate-pin"
              label={`رمز الدخول الجديد (${PIN_LENGTH} أرقام)`}
              value={pin}
              onChange={setPin}
              helperText="متشاركوش الرمز مع حد — ولا الأدمن نفسه بيعرفه."
            />
            <PinInput id="activate-pin-confirm" label="أكّد رمز الدخول" value={confirmPin} onChange={setConfirmPin} />

            {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="activate-submit">
              {isSubmitting ? 'جاري التفعيل…' : 'فعّل الحساب'}
            </Button>
            <Link href="/login" className="text-sm text-muted-foreground hover:underline">
              عندك رمز دخول بالفعل؟ سجّل دخول
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
