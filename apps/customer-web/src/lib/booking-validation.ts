import type { PricingFieldDto, PricingFieldValue } from './api-types';

/**
 * **أول حاجة ناقصة في الحجز — مكانها ورسالتها** (docs/08 §185 بند 9 و25).
 *
 * قبل كده زرار «التالي» كان بيتقفل رمادي وتحته «كمّل تفاصيل الشغل والموعد» — العميل مش عارف
 * **إيه** اللي ناقص ولا **فين**. دلوقتي الزرار شغّال، والضغطة بتودّي لأول بند ناقص (بترتيب
 * الشاشة) والرسالة بتظهر جنبه هو. نفس فكرة `PricingFieldsFormController` في تطبيق العميل.
 */
export interface BookingMissingItem {
  /** `address` / `field:<field_key>` / `schedule` / `provider` / `images` / `policies`. */
  key: string;
  step: 1 | 2 | 3;
  message: string;
}

/** نفس شرط الاكتمال القديم بالحرف (`pricingFieldsValid` في فلو الحجز). */
export function isPricingFieldComplete(field: PricingFieldDto, value: PricingFieldValue | undefined): boolean {
  if (field.field_type === 'image_upload') {
    const count = typeof value === 'string' ? value.split(',').filter(Boolean).length : 0;
    return count >= (field.min_files ?? (field.is_required ? 1 : 0));
  }
  if (!field.is_required) return true;
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== '';
}

/** رسالة بتقول للعميل **يعمل إيه** في الحقل ده بالذات — نفس صياغة التطبيق. */
export function pricingFieldMissingMessage(field: PricingFieldDto, purpose = 'علشان نقدر نحسب السعر'): string {
  const label = field.label_ar.trim();
  switch (field.field_type) {
    case 'dropdown':
    case 'multi_select':
      return `اختار «${label}» ${purpose}.`;
    case 'image_upload': {
      const minimum = field.min_files ?? 1;
      return `ارفع ${minimum > 1 ? `${minimum} صور على الأقل` : 'صورة على الأقل'} في «${label}» ${purpose}.`;
    }
    case 'date':
      return `حدد التاريخ في «${label}» ${purpose}.`;
    case 'time':
      return `حدد الوقت في «${label}» ${purpose}.`;
    case 'number':
    case 'area':
    case 'length':
    case 'volume':
      return `اكتب «${label}» ${purpose}.`;
    default:
      return `حدد «${label}» ${purpose}.`;
  }
}

/** بنود الحقول الناقصة بترتيب العرض (`display_order`) — مابيتغيّرش. */
export function missingPricingFields(
  fields: PricingFieldDto[],
  values: Record<string, PricingFieldValue>,
  purpose?: string,
): BookingMissingItem[] {
  return [...fields]
    .sort((a, b) => a.display_order - b.display_order)
    .filter((field) => !isPricingFieldComplete(field, values[field.field_key]))
    .map((field) => ({ key: `field:${field.field_key}`, step: 1 as const, message: pricingFieldMissingMessage(field, purpose) }));
}

/** أول بند ناقص لحد الخطوة دي (بما فيها الخطوات اللي قبلها). */
export function firstMissingUpTo(items: BookingMissingItem[], step: 1 | 2 | 3): BookingMissingItem | null {
  return items.find((item) => item.step <= step) ?? null;
}

/** معرّف عنصر الـDOM اللي بنمرّر له — مكان واحد يعرف الصيغة. */
export function bookingAnchorId(key: string): string {
  return `booking-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
