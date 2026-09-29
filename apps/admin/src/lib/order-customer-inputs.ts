import type { OrderCustomerInputDto } from '@baytak/shared-types';

const MAX_INLINE_UNIT_LENGTH = 24;

export function splitOrderCustomerInputs(inputs: OrderCustomerInputDto[]) {
  return {
    meaningful: inputs.filter((input) => input.is_default !== true || input.is_required === true),
    defaults: inputs.filter((input) => input.is_default === true && input.is_required !== true),
  };
}

export function displayOrderCustomerInput(input: OrderCustomerInputDto) {
  const numeric = Number(input.value);
  const value = input.integer_quantity === true && Number.isFinite(numeric)
    ? String(Math.round(numeric))
    : input.value;
  const unit = input.unit?.trim() || null;
  return {
    value: unit && unit.length <= MAX_INLINE_UNIT_LENGTH ? `${value} ${unit}` : value,
    explanation: unit && unit.length > MAX_INLINE_UNIT_LENGTH ? unit : null,
  };
}
