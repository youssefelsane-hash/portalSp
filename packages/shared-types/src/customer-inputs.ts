import type { OrderCustomerInputDto } from './orders';

/**
 * عرض بند من اختيارات العميل (docs/08 §185) — **نفس قواعد** `customer_inputs.dart` في تطبيق الفني:
 *
 * - `unit` أطول من ٢٤ حرف مش وحدة، ده شرح الأدمن للعميل («حدد عدد البلوزات في الطلب») — مابيتكتبش
 *   جنب القيمة. من غير القاعدة دي كانت الشاشة بتقول «0 حدد إجمالي عدد البناطيل…».
 * - `integer_quantity` ⇒ القيمة بتتقرّب للعرض، والقيمة **المخزّنة** بترجع في `storedValue` عشان الأدمن
 *   يشوف الحقيقة (نسخ التطبيق القديمة كانت بتبعت `1.9639…` والسعر اتحسب عليها).
 * - `isDefault` = حقل اختياري فضل على افتراضيه (من السيرفر، نفس قاعدة محرك التسعير). بند قديم بلا
 *   metadata ⇒ false (مابنخمّنش).
 */
export const MAX_INLINE_UNIT_LENGTH = 24;

export interface CustomerInputDisplay {
  key: string;
  label: string;
  /** القيمة + الوحدة القصيرة، جاهزة للعرض. */
  value: string;
  isDefault: boolean;
  /** القيمة زي ما اتخزّنت لو العرض قرّبها — `null` لو مفيش فرق. */
  storedValue: string | null;
}

export function describeCustomerInput(input: OrderCustomerInputDto): CustomerInputDisplay {
  const unit = input.unit?.trim() || null;
  const inlineUnit = unit && unit.length <= MAX_INLINE_UNIT_LENGTH ? unit : null;
  let shown = String(input.value ?? '').trim();
  let storedValue: string | null = null;
  if (input.integer_quantity === true && shown !== '' && Number.isFinite(Number(shown))) {
    const rounded = String(Math.round(Number(shown)));
    if (rounded !== shown) storedValue = shown;
    shown = rounded;
  }
  return {
    key: input.key,
    label: input.label,
    value: inlineUnit ? `${shown} ${inlineUnit}` : shown,
    isDefault: input.is_default === true && input.is_required !== true,
    storedValue,
  };
}
