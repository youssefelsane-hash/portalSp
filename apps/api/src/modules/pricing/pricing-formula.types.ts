// شكل شجرة المعادلة (Formula AST) المخزّنة في service_pricing_rules.payload لصف
// rule_type='formula'. راجع docs/adr/0001-dynamic-pricing-engine.md للقرار المعماري الكامل:
// القايمة دي هي كل العمليات المسموحة — أي حاجة برّه القايمة دي ترفض وقت الحفظ من الأدمن
// (formula-evaluator.ts)، مفيش أي تفسير لنص حر كجافاسكريبت/SQL خالص.

export type FormulaNode =
  | { type: 'literal'; value: number }
  | { type: 'field_ref'; field_key: string }
  | { type: 'constant_ref'; rule_key: string }
  | { type: 'lookup_ref'; rule_key: string; field_key: string }
  | { type: 'add'; operands: FormulaNode[] }
  | { type: 'subtract'; operands: FormulaNode[] }
  | { type: 'multiply'; operands: FormulaNode[] }
  | { type: 'divide'; operands: FormulaNode[] }
  // زيادة/نقصان بالنسبة المئوية — percentage(base, 15) = base × 1.15، percentage(base, -10) = base × 0.9
  | { type: 'percentage'; base: FormulaNode; percent: FormulaNode }
  | { type: 'min'; operands: FormulaNode[] }
  | { type: 'max'; operands: FormulaNode[] }
  | { type: 'round'; value: FormulaNode; decimals?: number }
  // Script 2 Part H (finding #43) — سياسة تسعير شائعة في الخدمات المنزلية: "أي جزء من وحدة
  // (متر/ساعة) يُحسب وحدة كاملة" (مثلاً مساحة زادت 0.1 م² عن الأساس → شريحة سعر تالية كاملة).
  // round() القديمة عمرها ما كانت هتعبّر عن السياسة دي (بتقرّب لأقرب قيمة، مش لأعلى دايمًا).
  // إضافة صرفة (node types جداد، مفيش تعديل على round نفسها) — الأدمن يختار يستخدمها لما
  // السياسة الفعلية تتأكد، مش تغيير سلوك أي معادلة موجودة بالفعل.
  | { type: 'ceil'; value: FormulaNode; decimals?: number }
  | { type: 'floor'; value: FormulaNode; decimals?: number }
  | { type: 'if'; condition: FormulaCondition; then: FormulaNode; else: FormulaNode }
  // ADR-0050 §2 — فرق بين تاريخين بوحدة مختارة. المدخلات **مصادر** مش أرقام عمدًا: التاريخ
  // مايعديش على field_ref أصلاً (بيرفض غير الأرقام)، والمرور بيه ككاسر للنوع كان هيسمح بضرب
  // epoch ms في سعر. راجع pricing-temporal.ts لدلالة كل وحدة.
  | {
      type: 'date_diff';
      from: FormulaDateSource;
      to: FormulaDateSource;
      unit: DateDiffUnit;
      rounding?: DateDiffRounding;
      inclusive?: boolean;
      absolute?: boolean;
    }
  // ADR-0050 §3 — مسافة كروية بين نقطتين (Haversine).
  | { type: 'distance'; from: FormulaGeoSource; to: FormulaGeoSource; unit: DistanceUnit };

export type DateDiffUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
export type DateDiffRounding = 'exact' | 'ceil' | 'floor' | 'round';
export type DistanceUnit = 'km' | 'm';

/** مصدر تاريخ داخل المعادلة — حقل من الفورم، أو موعد الخدمة نفسه، أو لحظة الحساب. */
export type FormulaDateSource =
  | { kind: 'field'; field_key: string }
  | { kind: 'scheduled_at' }
  | { kind: 'scheduled_end_at' }
  | { kind: 'period_start' }
  | { kind: 'period_end' }
  | { kind: 'now' };

/** مصدر نقطة جغرافية — حقل `location` من الفورم، أو موقع الطلب، أو نقطة ثابتة (مخزن/فرع). */
export type FormulaGeoSource =
  | { kind: 'field'; field_key: string }
  | { kind: 'order_location' }
  | { kind: 'point'; lat: number; lng: number };

export type ComparisonOperator = 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte';

export interface FormulaCondition {
  field_key: string;
  op: ComparisonOperator;
  value: string | number | boolean;
}

// payload صف rule_type='constant' — قيمة رقمية واحدة قابلة للتعديل من الأدمن.
export interface ConstantRulePayload {
  value: number;
}

// payload صف rule_type='lookup_table' — قيمة حقل (غالبًا dropdown) → رقم مقابل.
export interface LookupTableRulePayload {
  field_key: string;
  values: Record<string, number>;
}

// payload صف rule_type='formula' بـ rule_key='final_price' — المخرجات الكاملة للمحرك.
// price_cents إجباري، الباقي اختياري (لو الخدمة مش محتاجة تقدير مدة/طاقم مثلاً).
export interface FinalPriceFormulaPayload {
  price_cents: FormulaNode;
  min_price_cents?: FormulaNode;
  max_price_cents?: FormulaNode;
  estimated_duration_days?: FormulaNode;
  required_technicians?: FormulaNode;
  required_assistants?: FormulaNode;
  requires_assistant?: FormulaNode; // 0 = false، أي قيمة تانية = true
  suitable_for_emergency?: FormulaNode; // 0 = false، أي قيمة تانية = true
}

export interface PricingEvaluationResult {
  priceCents: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  estimatedDurationDays: number | null;
  requiredTechnicians: number | null;
  requiredAssistants: number | null;
  requiresAssistant: boolean | null;
  suitableForEmergency: boolean | null;
}
