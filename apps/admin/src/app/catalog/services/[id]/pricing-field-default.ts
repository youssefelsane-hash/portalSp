import type { CreatePricingFieldBody } from '@baytak/shared-types';

export const NUMERIC_PRICING_FIELD_TYPES = ['number', 'area', 'length', 'volume', 'slider'];

export function pricingFieldDefaultError(field: CreatePricingFieldBody): string | null {
  if (!NUMERIC_PRICING_FIELD_TYPES.includes(field.field_type) || !field.default_value?.trim()) return null;
  const value = Number(field.default_value);
  if (!Number.isFinite(value)) return 'القيمة الافتراضية لازم تكون رقمًا صالحًا';
  if (field.min_value != null && value < field.min_value) return 'القيمة الافتراضية أقل من الحد الأدنى المسموح';
  if (field.max_value != null && value > field.max_value) return 'القيمة الافتراضية أعلى من الحد الأقصى المسموح';
  return null;
}

export function pricingFieldDefaultPayload(value: string | undefined): string | null {
  // null يلغي القيمة القديمة عند التعديل؛ undefined يتركها محفوظة زي ما هي.
  return value?.trim() ? value : null;
}
