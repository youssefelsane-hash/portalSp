import { PricingEvaluationResult } from '../pricing-formula.types';
import { PricingFieldOption, PricingFieldType, ServicePricingField } from '../entities/service-pricing-field.entity';
import { PricingRuleType, ServicePricingRule } from '../entities/service-pricing-rule.entity';
import { ServicePricingRuleTest } from '../entities/service-pricing-rule-test.entity';

export interface PricingFieldResponseDto {
  id: string;
  service_id: string;
  field_key: string;
  label_ar: string;
  field_type: PricingFieldType;
  is_required: boolean;
  display_order: number;
  unit_ar: string | null;
  options: PricingFieldOption[] | null;
  min_value: number | null;
  max_value: number | null;
  is_active: boolean;
  created_at: string;
}

export function toPricingFieldResponseDto(field: ServicePricingField): PricingFieldResponseDto {
  return {
    id: field.id,
    service_id: field.serviceId,
    field_key: field.fieldKey,
    label_ar: field.labelAr,
    field_type: field.fieldType,
    is_required: field.isRequired,
    display_order: field.displayOrder,
    unit_ar: field.unitAr,
    options: field.options,
    min_value: field.minValue !== null ? Number(field.minValue) : null,
    max_value: field.maxValue !== null ? Number(field.maxValue) : null,
    is_active: field.isActive,
    created_at: field.createdAt.toISOString(),
  };
}

export interface PricingRuleResponseDto {
  id: string;
  service_id: string;
  rule_type: PricingRuleType;
  rule_key: string;
  payload: unknown;
  display_order: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

export function toPricingRuleResponseDto(rule: ServicePricingRule): PricingRuleResponseDto {
  return {
    id: rule.id,
    service_id: rule.serviceId,
    rule_type: rule.ruleType,
    rule_key: rule.ruleKey,
    payload: rule.payload,
    display_order: rule.displayOrder,
    valid_from: rule.validFrom.toISOString(),
    valid_until: rule.validUntil ? rule.validUntil.toISOString() : null,
    is_active: rule.isActive,
    created_at: rule.createdAt.toISOString(),
  };
}

export interface PricingEvaluationResponseDto {
  price_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  estimated_duration_days: number | null;
  required_technicians: number | null;
  required_assistants: number | null;
  requires_assistant: boolean | null;
  suitable_for_emergency: boolean | null;
}

export function toPricingEvaluationResponseDto(result: PricingEvaluationResult): PricingEvaluationResponseDto {
  return {
    price_cents: result.priceCents,
    min_price_cents: result.minPriceCents,
    max_price_cents: result.maxPriceCents,
    estimated_duration_days: result.estimatedDurationDays,
    required_technicians: result.requiredTechnicians,
    required_assistants: result.requiredAssistants,
    requires_assistant: result.requiresAssistant,
    suitable_for_emergency: result.suitableForEmergency,
  };
}

// Script 4 Part L §48 — حالة اختبار محفوظة لمعادلة تسعير خدمة.
export interface PricingRuleTestResponseDto {
  id: string;
  service_id: string;
  label: string;
  field_values: Record<string, string | number | boolean>;
  expected_price_cents: number;
  created_at: string;
}

export function toPricingRuleTestResponseDto(test: ServicePricingRuleTest): PricingRuleTestResponseDto {
  return {
    id: test.id,
    service_id: test.serviceId,
    label: test.label,
    field_values: test.fieldValues,
    expected_price_cents: test.expectedPriceCents,
    created_at: test.createdAt.toISOString(),
  };
}

export interface PricingRuleTestRunResultDto {
  id: string;
  label: string;
  expected_price_cents: number;
  actual_price_cents: number | null;
  passed: boolean;
  error: string | null;
}
