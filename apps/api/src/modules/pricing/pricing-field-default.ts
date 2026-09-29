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
