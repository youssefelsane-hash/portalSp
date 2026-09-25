'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LEGACY_PIN_MIN_LENGTH, PIN_LENGTH } from '@/lib/pin-policy';

/**
 * خانة رمز دخول — أرقام بس، مخفية، وبسقف الطول الصح.
 *
 * **اتطلّعت من `change-pin-card.tsx`** عشان شاشة التنشيط تستخدم نفس الخانة بالظبط: نسخة تانية
 * معناها خانة بتقبل ٧ أرقام وواحدة لأ، أو واحدة بتسمح بحروف.
 *
 * @param allowLegacy خانة **دخول** لحساب رمزه من قبل التصليب (٤–٦). أي خانة **تعيين** رمز جديد
 *   بتسيبها `false` — الرمز الجديد ستة بالظبط.
 */
export function PinInput({
  id,
  label,
  value,
  onChange,
  allowLegacy = false,
  autoComplete = 'new-password',
  helperText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  allowLegacy?: boolean;
  autoComplete?: string;
  helperText?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        data-testid={id}
        type="password"
        inputMode="numeric"
        maxLength={PIN_LENGTH}
        minLength={allowLegacy ? LEGACY_PIN_MIN_LENGTH : PIN_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
        required
        dir="ltr"
        autoComplete={autoComplete}
      />
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
    </div>
  );
}
