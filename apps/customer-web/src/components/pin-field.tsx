'use client';

/**
 * **خانة رمز دخول** (ADR-0109) — خانة واحدة بسلوك موحّد في كل شاشات الرمز.
 *
 * `type="password"` مقصود: الرمز **دائم** مش كود بيموت بعد دقايق، فحد واقف جنب الشاشة مايقراهوش.
 * ومفيش `autoComplete="one-time-code"` — ده مش كود من SMS، والمتصفح مايعرضش اقتراحات غلط.
 *
 * `inputMode="numeric"` + `pattern` بيطلّعوا كيبورد أرقام على الموبايل. الفلترة في `onChange`
 * مش على الـ`pattern` لوحده: الـ`pattern` تحقّق عند الإرسال بس، والمستخدم لازم يشوف إن الحرف
 * مش بيتكتب أصلاً.
 */
export function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus = false,
  autoComplete = 'off',
  allowLegacy = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  autoComplete?: 'off' | 'current-password' | 'new-password';
  /** الدخول فقط يقبل الرموز القديمة ٤–٥ أرقام؛ أي رمز جديد ستة أرقام بالضبط. */
  allowLegacy?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        id={id}
        data-testid={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        required
        minLength={allowLegacy ? 4 : 6}
        maxLength={6}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
        dir="ltr"
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg tracking-[0.5em] outline-none focus:border-primary"
      />
    </label>
  );
}

/**
 * نفس قاعدة `isWeakPin` في `login-pin.policy.ts` بالحرف — كله نفس الرقم، أو تسلسل صاعد/نازل.
 *
 * الباك-إند هو مصدر الحقيقة وبيفحص تاني؛ ده بس عشان المستخدم ياخد رد فوري بدل رحلة شبكة.
 */
export function isWeakPin(pin: string): boolean {
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

/** نفس نصوص `login-pin.policy.ts` بالحرف عشان المستخدم مايشوفش رسالتين مختلفتين لنفس السبب. */
export function localPinError(
  pin: string,
  { requireStrong, allowLegacy = false }: { requireStrong: boolean; allowLegacy?: boolean },
): string | null {
  if (pin.length > 6 || pin.length < (allowLegacy ? 4 : 6)) {
    return allowLegacy ? 'رمز الدخول لازم يكون من 4 لـ6 أرقام' : 'رمز الدخول لازم يكون 6 أرقام';
  }
  if (requireStrong && isWeakPin(pin)) {
    return 'الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم';
  }
  return null;
}
