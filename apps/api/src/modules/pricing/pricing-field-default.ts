import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';

const NUMERIC_FIELD_TYPES = new Set([
  PricingFieldType.NUMBER, PricingFieldType.SLIDER, PricingFieldType.AREA,
  PricingFieldType.LENGTH, PricingFieldType.VOLUME,
]);

export function assertNumericPricingDefault(
  field: Pick<ServicePricingField, 'fieldType' | 'labelAr' | 'defaultValue' | 'minValue' | 'maxValue'>,
): void {
  if (!NUMERIC_FIELD_TYPES.has(field.fieldType) || field.defaultValue == null) return;
  const value = Number(field.defaultValue);
  const prefix = `القيمة الافتراضية للحقل "${field.labelAr}"`;
  if (!field.defaultValue.trim() || !Number.isFinite(value)) {
    throw new ApiException(ErrorCode.VAL_001, `${prefix} لازم تكون رقمًا صالحًا`, HttpStatus.BAD_REQUEST);
  }
  if (field.minValue !== null && value < Number(field.minValue)) {
    throw new ApiException(ErrorCode.VAL_001, `${prefix} أقل من الحد الأدنى المسموح`, HttpStatus.BAD_REQUEST);
  }
  if (field.maxValue !== null && value > Number(field.maxValue)) {
    throw new ApiException(ErrorCode.VAL_001, `${prefix} أعلى من الحد الأقصى المسموح`, HttpStatus.BAD_REQUEST);
  }
}

type DefaultRuleField = Pick<ServicePricingField, 'fieldType' | 'defaultValue' | 'minValue'>;

/**
 * القيمة اللي المحرك بيستخدمها لحقل اختياري العميل ما لمسهوش (migration `0138`).
 *
 * `default_value` مخزّن نص خام بيتفسّر حسب field_type. من غير default صريح: CHECKBOX بياخد false
 * وSLIDER بياخد min_value أو 0 (نفس موضعه الابتدائي في التطبيق)، وباقي الأنواع undefined — يعني
 * الحقل بيتجاهل، ولو المعادلة محتاجاه بتترفض بوضوح.
 *
 * **مابترميش** عمدًا: المحرك بيتحقق من صلاحية الـdefault قبل ما يناديها
 * (`assertNumericPricingDefault`)، والـsnapshot بتاع العرض مايصحّش يوقع بسبب إعداد أدمن غلط.
 */
export function resolvePricingFieldDefault(field: DefaultRuleField): string | number | boolean | undefined {
  if (field.defaultValue != null) {
    if (field.fieldType === PricingFieldType.CHECKBOX) return field.defaultValue === 'true';
    if (field.fieldType === PricingFieldType.NUMBER || field.fieldType === PricingFieldType.SLIDER) {
      const numeric = Number(field.defaultValue);
      return Number.isFinite(numeric) ? numeric : field.defaultValue;
    }
    return field.defaultValue;
  }
  if (field.fieldType === PricingFieldType.CHECKBOX) return false;
  if (field.fieldType === PricingFieldType.SLIDER) return Number(field.minValue ?? 0);
  return undefined;
}

/**
 * هل القيمة اللي العميل بعتها هي نفسها اللي المحرك كان هيفترضها لو ما بعتهاش؟
 *
 * للعرض بس (snapshot اختيارات العميل، docs/08 §185): تطبيق الفني بيستخدمها عشان مايعرضش
 * «تيشيرتات: 0» و«نفس الخدمة الأساسية» لحقول اختيارية العميل ماغيّرهاش. **ممنوع** تدخل التسعير.
 */
export function isPricingFieldDefaultValue(field: DefaultRuleField, raw: unknown): boolean {
  const fallback = resolvePricingFieldDefault(field);
  if (fallback === undefined || raw === undefined || raw === null) return false;
  if (typeof fallback === 'boolean') return raw === fallback;
  if (typeof fallback === 'number') {
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(numeric) && numeric === fallback;
  }
  return (Array.isArray(raw) ? raw.map(String).join(',') : String(raw)) === fallback;
}

/**
 * slider حدوده أعداد صحيحة = عدّاد قطع/غرف/أجهزة، مش قيمة متصلة. التطبيق الجديد بيبعت أعداد
 * صحيحة من المصدر؛ العلامة دي بتخلّي العرض ينضّف القيم الكسرية اللي النسخ القديمة بعتتها
 * (`1.9639846991701237 قميص`) من غير ما نلمس القيمة المخزّنة نفسها.
 */
export function isIntegerQuantityField(field: Pick<ServicePricingField, 'fieldType' | 'minValue' | 'maxValue'>): boolean {
  if (field.fieldType !== PricingFieldType.SLIDER) return false;
  const min = Number(field.minValue ?? 0);
  const max = Number(field.maxValue ?? 100);
  return Number.isInteger(min) && Number.isInteger(max);
}
