import type { PricingFieldDto } from './api-types';

type SliderField = Pick<PricingFieldDto, 'min_value' | 'max_value' | 'default_value' | 'is_required'>;

export function pricingSliderState(field: SliderField, value: number | undefined) {
  const min = field.min_value ?? 0;
  const max = Math.max(field.max_value ?? 100, min + 1);
  const integer = Number.isInteger(min) && Number.isInteger(max);
  const stepper = integer && max - min <= 30;
  const parsedDefault = field.default_value === null ? NaN : Number(field.default_value);
  const fallback = !field.is_required && Number.isFinite(parsedDefault) ? parsedDefault : min;
  const raw = value ?? (field.is_required && stepper ? null : fallback);
  const current = raw === null ? null : Math.min(max, Math.max(min, integer ? Math.round(raw) : raw));
  return { min, max, integer, stepper, current };
}

export function nextPricingSliderStep(current: number | null, min: number, max: number, direction: 1 | -1) {
  if (current === null) return direction === 1 ? Math.min(max, min + 1) : min;
  return Math.min(max, Math.max(min, current + direction));
}
