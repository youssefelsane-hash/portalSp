// محرك التسعير الديناميكي (docs/08 §1، ADR-0001، docs/adr/0001-dynamic-pricing-engine.md) — مطابق
// لـ apps/api/src/modules/pricing/dto/*.ts وentities. راجع apps/api/src/modules/pricing/README.md.

export type PricingFieldType =
  | 'number'
  | 'dropdown'
  | 'multi_select'
  | 'checkbox'
  | 'slider'
  | 'area'
  | 'length'
  | 'volume'
  | 'date'
  | 'time'
  | 'location'
  | 'image_upload'
  | 'video_upload'
  | 'voice_note';

export interface PricingFieldOption {
  value: string;
  label_ar: string;
}

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

export interface CreatePricingFieldBody {
  field_key: string;
  label_ar: string;
  field_type: PricingFieldType;
  is_required?: boolean;
  display_order?: number;
  unit_ar?: string;
  options?: PricingFieldOption[];
  min_value?: number;
  max_value?: number;
}

export interface UpdatePricingFieldBody extends Partial<CreatePricingFieldBody> {
  is_active?: boolean;
}

export type PricingRuleType = 'constant' | 'lookup_table' | 'formula';

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

export interface UpsertPricingRuleBody {
  rule_type: PricingRuleType;
  rule_key: string;
  payload: Record<string, unknown>;
  display_order?: number;
  valid_from?: string;
}

// payload صف rule_type='constant'
export interface ConstantRulePayload {
  value: number;
}

// payload صف rule_type='lookup_table'
export interface LookupTableRulePayload {
  field_key: string;
  values: Record<string, number>;
}

// شجرة معادلة آمنة (Formula AST) — مطابقة لـ pricing-formula.types.ts's FormulaNode بالحرف.
// مفيش eval/new Function خالص، القايمة دي هي كل العمليات المسموحة.
export type FormulaNode =
  | { type: 'literal'; value: number }
  | { type: 'field_ref'; field_key: string }
  | { type: 'constant_ref'; rule_key: string }
  | { type: 'lookup_ref'; rule_key: string; field_key: string }
  | { type: 'add'; operands: FormulaNode[] }
  | { type: 'subtract'; operands: FormulaNode[] }
  | { type: 'multiply'; operands: FormulaNode[] }
  | { type: 'divide'; operands: FormulaNode[] }
  | { type: 'percentage'; base: FormulaNode; percent: FormulaNode }
  | { type: 'min'; operands: FormulaNode[] }
  | { type: 'max'; operands: FormulaNode[] }
  | { type: 'round'; value: FormulaNode; decimals?: number }
  | { type: 'ceil'; value: FormulaNode; decimals?: number }
  | { type: 'floor'; value: FormulaNode; decimals?: number }
  | { type: 'if'; condition: FormulaCondition; then: FormulaNode; else: FormulaNode };

export type ComparisonOperator = 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte';

export interface FormulaCondition {
  field_key: string;
  op: ComparisonOperator;
  value: string | number | boolean;
}

// payload صف rule_type='formula' بـ rule_key='final_price' — المخرجات الكاملة للمحرك.
export interface FinalPriceFormulaPayload {
  price_cents: FormulaNode;
  min_price_cents?: FormulaNode;
  max_price_cents?: FormulaNode;
  estimated_duration_days?: FormulaNode;
  required_technicians?: FormulaNode;
  required_assistants?: FormulaNode;
  requires_assistant?: FormulaNode;
  suitable_for_emergency?: FormulaNode;
}

export interface EvaluatePricingBody {
  field_values: Record<string, string | number | boolean>;
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

// معاينة مسوّدة قبل الحفظ (Script 4 Part L §47-48) — مطابق لـ
// apps/api/src/modules/pricing/dto/evaluate-draft-pricing.dto.ts
export interface EvaluateDraftPricingBody {
  field_values: Record<string, string | number | boolean>;
  formula_payload?: FinalPriceFormulaPayload;
}

// مطابق لـ apps/api/src/modules/pricing/dto/create-pricing-rule-test.dto.ts
export interface CreatePricingRuleTestBody {
  label: string;
  field_values: Record<string, string | number | boolean>;
  expected_price_cents: number;
}

export interface PricingRuleTestResponseDto {
  id: string;
  service_id: string;
  label: string;
  field_values: Record<string, string | number | boolean>;
  expected_price_cents: number;
  created_at: string;
}

// مطابق لـ apps/api/src/modules/pricing/dto/run-pricing-rule-tests.dto.ts
export interface RunPricingRuleTestsBody {
  formula_payload?: FinalPriceFormulaPayload;
}

export interface PricingRuleTestRunResultDto {
  id: string;
  label: string;
  expected_price_cents: number;
  actual_price_cents: number | null;
  passed: boolean;
  error: string | null;
}
