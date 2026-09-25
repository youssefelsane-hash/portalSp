'use client';

/**
 * **خانة رقم الموبايل** — مصدر واحد لكل شاشات الدخول/التسجيل/الاسترجاع.
 *
 * اتطلّعت لأن نفس الـ١٣ سطر كانوا **متكررين بالحرف** في `login` و`register` و`pin-reset`: أي
 * تحسين (نوع الكيبورد، الإكمال التلقائي، رسالة، مقاس) كان لازم يتكرر تلات مرات، والنسيان في
 * واحدة بيدّي شاشة بتتصرّف غير أختها — وده بالظبط اللي المالك اشتكى منه (2026-09-25).
 *
 * ### الاتنين اللي اتصلّحوا وقت الاستخراج
 *
 * - **`inputMode="tel"`**: `type="tel"` لوحده مش بيضمن كيبورد الأرقام على كل المتصفحات، وشاشة
 *   تفعيل الموظف في الأدمن كانت محطّاه فعلاً — يعني شاشتين بكيبوردين مختلفين لنفس الحقل.
 * - **`enterKeyHint`**: من غيره زرار الإدخال بيقول «Enter» ومابيقفلش الكيبورد. `next` بيوّدي
 *   للخانة اللي بعدها، والكيبورد بيتقفل لوحده عند الإرسال من الخانة الأخيرة.
 */
export function PhoneField({
  id,
  value,
  onChange,
  label = 'رقم الموبايل',
  autoFocus = false,
  autoComplete = 'tel',
  enterKeyHint = 'next',
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  label?: string;
  autoFocus?: boolean;
  autoComplete?: 'tel' | 'username' | 'off';
  enterKeyHint?: 'next' | 'go' | 'done';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        id={id}
        data-testid={id}
        type="tel"
        inputMode="tel"
        enterKeyHint={enterKeyHint}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+2010xxxxxxxx"
        dir="ltr"
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left outline-none focus:border-primary"
      />
    </label>
  );
}
