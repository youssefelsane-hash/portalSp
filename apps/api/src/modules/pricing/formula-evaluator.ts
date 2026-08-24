import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { FORMULA_LIMITS } from './formula-limits';
import {
  ComparisonOperator,
  ConstantRulePayload,
  FinalPriceFormulaPayload,
  FormulaCondition,
  FormulaNode,
  LookupTableRulePayload,
} from './pricing-formula.types';

// أقصى عمق لشجرة المعادلة — دفاع ضد أشجار متداخلة بشكل مرضي (تعمل stack overflow أو DoS).
// 12 كانت كافية للخدمات الموجودة، لكن خدمات SONNA3 المعقدة محتاجة أعمق — 48 (طلب مالك صريح،
// docs/01B §2) مع حماية إضافية بعدد العقد وحجم الـpayload (تحت) عشان العمق لوحده مش حد أمني
// كافي: شجرة عريضة عمقها 2 ممكن تكون ضخمة.
const MAX_FORMULA_DEPTH = FORMULA_LIMITS.MAX_DEPTH;

const ALLOWED_NODE_TYPES = new Set<FormulaNode['type']>([
  'literal',
  'field_ref',
  'constant_ref',
  'lookup_ref',
  'add',
  'subtract',
  'multiply',
  'divide',
  'percentage',
  'min',
  'max',
  'round',
  'ceil',
  'floor',
  'if',
]);

const ALLOWED_COMPARISON_OPERATORS = new Set<ComparisonOperator>(['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte']);

function rejectFormula(reason: string, path?: string): never {
  const location = path ? `${path}: ` : '';
  throw new ApiException(ErrorCode.VAL_001, `معادلة تسعير غير صالحة: ${location}${reason}`, HttpStatus.BAD_REQUEST);
}

/**
 * سياق التحقق — بيتتبع مسار العقدة الحالية (زي `price_cents → add.operands[3]`) وعدد العقد
 * الكلي عشان الأخطاء توضّح **مكان** المشكلة بالظبط (docs/01B §8: "Bad: Invalid formula /
 * Better: price_cents → Add → Operand 4 → lookup_ref ...") والتعقيد يفضل محدود.
 */
interface ValidationContext {
  path: string[];
  nodeCount: number;
}

function currentPath(ctx: ValidationContext): string {
  return ctx.path.join(' → ');
}

/**
 * بيتنادى وقت حفظ المعادلة من الأدمن (مش وقت تنفيذها على العميل) — بيتأكد إن الشجرة كلها
 * بتستخدم بس العمليات المسموحة (`ALLOWED_NODE_TYPES`) وإن عمقها وعدد عناصرها جوّه الحدود.
 * أي عملية برّه القايمة دي بترفض هنا فورًا، قبل ما تتخزن في service_pricing_rules.payload
 * خالص — راجع docs/adr/0001-dynamic-pricing-engine.md للسبب الأمني الكامل.
 *
 * الأخطاء بتتضمن مسار العقدة (path) عشان الواجهة تقدر تعرض/توصل للمكان المطلوب مباشرة.
 */
export function validateFormulaNode(node: unknown, depthOrCtx: number | ValidationContext = 0): void {
  // توقيع قديم متوافق: validateFormulaNode(node, depth) — بيتنادى من validateFinalPriceFormulaPayload
  // دايمًا بـcontext كامل، بس بنحافظ على التوافق لأي استدعاء خارجي قديم.
  const ctx: ValidationContext =
    typeof depthOrCtx === 'number'
      ? { path: ['price_cents'], nodeCount: 0 }
      : depthOrCtx;

  if (ctx.nodeCount >= FORMULA_LIMITS.MAX_NODE_COUNT) {
    rejectFormula(`عدد عناصر المعادلة تعدّى الحد المسموح (${FORMULA_LIMITS.MAX_NODE_COUNT})`, currentPath(ctx));
  }
  if (ctx.path.length - 1 > MAX_FORMULA_DEPTH) {
    rejectFormula(`الشجرة أعمق من الحد المسموح (${MAX_FORMULA_DEPTH} مستوى)`, currentPath(ctx));
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    rejectFormula('كل عقدة لازم تكون object', currentPath(ctx));
  }
  const candidate = node as Record<string, unknown>;
  const type = candidate.type;
  if (typeof type !== 'string' || !ALLOWED_NODE_TYPES.has(type as FormulaNode['type'])) {
    rejectFormula(`نوع عقدة غير مسموح: ${String(type)}`, currentPath(ctx));
  }

  ctx.nodeCount += 1;

  switch (type as FormulaNode['type']) {
    case 'literal':
      if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) {
        rejectFormula('literal.value لازم يكون رقم', currentPath(ctx));
      }
      return;
    case 'field_ref':
      if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
        rejectFormula('field_ref.field_key لازم يكون نص غير فاضي', currentPath(ctx));
      }
      return;
    case 'constant_ref':
      if (typeof candidate.rule_key !== 'string' || candidate.rule_key.length === 0) {
        rejectFormula('constant_ref.rule_key لازم يكون نص غير فاضي', currentPath(ctx));
      }
      return;
    case 'lookup_ref':
      if (typeof candidate.rule_key !== 'string' || candidate.rule_key.length === 0) {
        rejectFormula('lookup_ref.rule_key لازم يكون نص غير فاضي', currentPath(ctx));
      }
      if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
        rejectFormula('lookup_ref.field_key لازم يكون نص غير فاضي', currentPath(ctx));
      }
      return;
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max': {
      if (!Array.isArray(candidate.operands) || candidate.operands.length < 1) {
        rejectFormula(`${type}.operands لازم تكون مصفوفة فيها عنصر واحد على الأقل`, currentPath(ctx));
      }
      const operands = candidate.operands as unknown[];
      for (let i = 0; i < operands.length; i += 1) {
        ctx.path.push(`${type}.operands[${i}]`);
        validateFormulaNode(operands[i], ctx);
        ctx.path.pop();
      }
      return;
    }
    case 'percentage':
      ctx.path.push('percentage.base');
      validateFormulaNode(candidate.base, ctx);
      ctx.path.pop();
      ctx.path.push('percentage.percent');
      validateFormulaNode(candidate.percent, ctx);
      ctx.path.pop();
      return;
    case 'round':
    case 'ceil':
    case 'floor':
      ctx.path.push(String(type));
      validateFormulaNode(candidate.value, ctx);
      ctx.path.pop();
      if (candidate.decimals !== undefined && typeof candidate.decimals !== 'number') {
        rejectFormula(`${String(type)}.decimals لازم يكون رقم لو موجود`, currentPath(ctx));
      }
      return;
    case 'if':
      validateFormulaCondition(candidate.condition, currentPath(ctx));
      ctx.path.push('if.then');
      validateFormulaNode(candidate.then, ctx);
      ctx.path.pop();
      ctx.path.push('if.else');
      validateFormulaNode(candidate.else, ctx);
      ctx.path.pop();
      return;
  }
}

function validateFormulaCondition(condition: unknown, path: string): void {
  if (typeof condition !== 'object' || condition === null) {
    rejectFormula('if.condition لازم يكون object', `${path} → if.condition`);
  }
  const candidate = condition as Record<string, unknown>;
  if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
    rejectFormula('condition.field_key لازم يكون نص غير فاضي', `${path} → if.condition`);
  }
  if (typeof candidate.op !== 'string' || !ALLOWED_COMPARISON_OPERATORS.has(candidate.op as ComparisonOperator)) {
    rejectFormula(`condition.op غير مسموح: ${String(candidate.op)}`, `${path} → if.condition`);
  }
  const valueType = typeof candidate.value;
  if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
    rejectFormula('condition.value لازم يكون نص أو رقم أو boolean', `${path} → if.condition`);
  }
}

export interface FormulaEvaluationContext {
  fieldValues: Record<string, string | number | boolean>;
  constants: Map<string, ConstantRulePayload>;
  lookupTables: Map<string, LookupTableRulePayload>;
}

const OPTIONAL_FORMULA_OUTPUT_KEYS: (keyof FinalPriceFormulaPayload)[] = [
  'min_price_cents',
  'max_price_cents',
  'estimated_duration_days',
  'required_technicians',
  'required_assistants',
  'requires_assistant',
  'suitable_for_emergency',
];

/**
 * فحص شكل payload معادلة final_price كاملة + حدود التعقيد الكلية — مشتركة بين
 * PricingRulesService.upsert() (وقت الحفظ الحقيقي) وPricingEngineService.evaluateDraft()
 * (وقت المعاينة قبل الحفظ) — نفس القواعد بالحرف في المكانين، صفر تكرار منطق.
 *
 * حدود التعقيد (عمق/عقد/حجم) بتتفحص هنا على مستوى payload الكامل قبل فحص أي شجرة فرعية.
 */
export function validateFinalPriceFormulaPayload(payload: Record<string, unknown>): void {
  if (payload.price_cents === undefined) {
    rejectFormula('formula.price_cents إجباري');
  }

  // حجم الـJSON الكلي — قبل أي مشي في الشجرة (أرخص فحص وأوضح رسالة)
  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    rejectFormula('payload مش JSON صالح');
  }
  if (payloadBytes > FORMULA_LIMITS.MAX_PAYLOAD_JSON_BYTES) {
    rejectFormula(
      `حجم المعادلة (${payloadBytes} بايت) تعدّى الحد المسموح (${FORMULA_LIMITS.MAX_PAYLOAD_JSON_BYTES} بايت)`,
    );
  }

  const ctx: ValidationContext = { path: [], nodeCount: 0 };

  ctx.path.push('price_cents');
  validateFormulaNode(payload.price_cents, ctx);
  ctx.path.pop();
  for (const key of OPTIONAL_FORMULA_OUTPUT_KEYS) {
    if (payload[key] !== undefined) {
      ctx.path.push(key);
      validateFormulaNode(payload[key], ctx);
      ctx.path.pop();
    }
  }
}

/** عدد العقد الكلي في payload معادلة (لعرضه في واجهة الأدمن) — نفس عدّاد التحقق. */
export function countFormulaNodes(payload: FinalPriceFormulaPayload): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const candidate = node as Record<string, unknown>;
    if (typeof candidate.type !== 'string' || !ALLOWED_NODE_TYPES.has(candidate.type as FormulaNode['type'])) return;
    count += 1;
    switch (candidate.type as FormulaNode['type']) {
      case 'literal':
      case 'field_ref':
      case 'constant_ref':
      case 'lookup_ref':
        return;
      case 'percentage':
        walk(candidate.base);
        walk(candidate.percent);
        return;
      case 'round':
      case 'ceil':
      case 'floor':
        walk(candidate.value);
        return;
      case 'if':
        walk(candidate.then);
        walk(candidate.else);
        return;
      default:
        for (const operand of (candidate.operands ?? []) as unknown[]) walk(operand);
    }
  };
  for (const key of ['price_cents', ...OPTIONAL_FORMULA_OUTPUT_KEYS] as (keyof FinalPriceFormulaPayload)[]) {
    if (payload[key] !== undefined) walk(payload[key]);
  }
  return count;
}

function toComparableNumber(value: string | number | boolean): number | string {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

// حقول dropdown (زي "السمك: 3 سم") قيمتها دايمًا نص ("3") حتى لو شكلها رقمي — بينما الأدمن
// طبيعي يكتب قيمة المقارنة في الشرط كرقم (value: 3). المقارنة النصية الصارمة كانت هترفض
// المطابقة دي غلط ("3" !== 3)، فـ equals/not_equals بيقارنوا رقميًا لو الطرفين قابلين للتحويل
// لرقم صالح، ويرجعوا لمقارنة نصية عادية لو لأ (زي "internal" === "internal").
function looseEquals(left: string | number, right: string | number): boolean {
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum)) {
    return leftNum === rightNum;
  }
  return String(left) === String(right);
}

function evaluateCondition(condition: FormulaCondition, context: FormulaEvaluationContext): boolean {
  const fieldValue = context.fieldValues[condition.field_key];
  if (fieldValue === undefined) {
    throw new ApiException(ErrorCode.VAL_001, `الحقل "${condition.field_key}" مطلوب لتقييم الشرط`, HttpStatus.BAD_REQUEST);
  }
  const left = toComparableNumber(fieldValue);
  const right = toComparableNumber(condition.value as string | number | boolean);

  switch (condition.op) {
    case 'equals':
      return looseEquals(left, right);
    case 'not_equals':
      return !looseEquals(left, right);
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
  }
}

/**
 * تنفيذ فعلي لشجرة معادلة اتوثّقت بالفعل (validateFormulaNode) — بيتنادى وقت حساب سعر حقيقي
 * لعميل. برضه بيرفض بوضوح لو حقل/ثابت/lookup مطلوب في الشجرة مش موجود في السياق، بدل ما
 * يرجع NaN أو يكسر بصمت. عمق 48 آمن هنا: الشجرة اتحددت حجمها وقت الحفظ (عقد ≤ 1500)،
 * والتقييم recursion depth أقصاه 48 — بعيد جدًا عن أي stack overflow واقعي.
 */
export function evaluateFormulaNode(node: FormulaNode, context: FormulaEvaluationContext): number {
  switch (node.type) {
    case 'literal':
      return node.value;

    case 'field_ref': {
      const value = context.fieldValues[node.field_key];
      if (value === undefined) {
        throw new ApiException(ErrorCode.VAL_001, `الحقل "${node.field_key}" مطلوب لحساب السعر`, HttpStatus.BAD_REQUEST);
      }
      const numeric = Number(toComparableNumber(value));
      // Script 2 Part H (finding #42) — كانت بَقّة حقيقية: قيمة نصية مش رقمية (زي "hello" بدل
      // "3") كانت بتتحول لـNaN هنا من غير أي فحص، وNaN بتتسرّب صامتة عبر كل عمليات المعادلة
      // الحسابية (add/multiply/...) لحد السعر النهائي. `validateAndNormalizeFieldValues`
      // (pricing-engine.service.ts) بتتجاهل الفحص عمدًا للحقول من غير min/max مُعرّف
      // (تصنيفية زي dropdown نص) — هنا بس، لحظة الاستخدام الفعلي كرقم في المعادلة، إحنا
      // متأكدين إن السياق محتاج رقم فنرفض بوضوح لو مش رقم صالح.
      if (!Number.isFinite(numeric)) {
        throw new ApiException(
          ErrorCode.VAL_001,
          `قيمة الحقل "${node.field_key}" لازم تكون رقم صالح لحساب السعر — القيمة الحالية غير رقمية`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return numeric;
    }

    case 'constant_ref': {
      const constant = context.constants.get(node.rule_key);
      if (!constant) {
        throw new ApiException(ErrorCode.VAL_001, `الثابت "${node.rule_key}" غير موجود لهذه الخدمة`, HttpStatus.BAD_REQUEST);
      }
      return constant.value;
    }

    case 'lookup_ref': {
      const table = context.lookupTables.get(node.rule_key);
      if (!table) {
        throw new ApiException(ErrorCode.VAL_001, `جدول البحث "${node.rule_key}" غير موجود لهذه الخدمة`, HttpStatus.BAD_REQUEST);
      }
      const fieldValue = context.fieldValues[table.field_key];
      if (fieldValue === undefined) {
        throw new ApiException(ErrorCode.VAL_001, `الحقل "${table.field_key}" مطلوب لجدول البحث "${node.rule_key}"`, HttpStatus.BAD_REQUEST);
      }
      const key = String(fieldValue);
      const value = table.values[key];
      if (value === undefined) {
        throw new ApiException(ErrorCode.VAL_001, `مفيش قيمة في جدول البحث "${node.rule_key}" للاختيار "${key}"`, HttpStatus.BAD_REQUEST);
      }
      return value;
    }

    case 'add':
      return node.operands.reduce((sum, operand) => sum + evaluateFormulaNode(operand, context), 0);

    case 'subtract': {
      const [first, ...rest] = node.operands;
      return rest.reduce((acc, operand) => acc - evaluateFormulaNode(operand, context), evaluateFormulaNode(first, context));
    }

    case 'multiply':
      return node.operands.reduce((product, operand) => product * evaluateFormulaNode(operand, context), 1);

    case 'divide': {
      const [first, ...rest] = node.operands;
      return rest.reduce((acc, operand) => {
        const divisor = evaluateFormulaNode(operand, context);
        if (divisor === 0) {
          throw new ApiException(ErrorCode.VAL_001, 'قسمة على صفر في معادلة التسعير', HttpStatus.BAD_REQUEST);
        }
        return acc / divisor;
      }, evaluateFormulaNode(first, context));
    }

    case 'percentage': {
      const base = evaluateFormulaNode(node.base, context);
      const percent = evaluateFormulaNode(node.percent, context);
      return base * (1 + percent / 100);
    }

    case 'min':
      return Math.min(...node.operands.map((operand) => evaluateFormulaNode(operand, context)));

    case 'max':
      return Math.max(...node.operands.map((operand) => evaluateFormulaNode(operand, context)));

    case 'round': {
      const value = evaluateFormulaNode(node.value, context);
      const factor = 10 ** (node.decimals ?? 0);
      return Math.round(value * factor) / factor;
    }

    case 'ceil': {
      const value = evaluateFormulaNode(node.value, context);
      const factor = 10 ** (node.decimals ?? 0);
      return Math.ceil(value * factor) / factor;
    }

    case 'floor': {
      const value = evaluateFormulaNode(node.value, context);
      const factor = 10 ** (node.decimals ?? 0);
      return Math.floor(value * factor) / factor;
    }

    case 'if':
      return evaluateCondition(node.condition, context) ? evaluateFormulaNode(node.then, context) : evaluateFormulaNode(node.else, context);
  }
}

/** مرجع مُجمَّع من الشجرة مع مساره — لرسائل تحقق من نوع "price_cents → ... : الثابت غير موجود". */
export interface CollectedFormulaReference {
  kind: 'field' | 'constant' | 'lookup' | 'lookup_bound_field';
  key: string;
  /** للـlookup: الحقل المرتبط بالجدول. */
  extraKey?: string;
  path: string;
}

/**
 * بتجمع كل المراجع (حقول/ثوابت/جداول بحث/شروط) من payload كامل مع مسار كل مرجع — بتنادى
 * وقت الحفظ من PricingRulesService عشان تتفحص ضد تهيئة الخدمة الفعلية (حقل متمسوح/ثابت
 * مش موجود/lookup مربوط بحقل غلط...) برسائل بتوضّح المكان بالظبط.
 *
 * ملاحظة تصميم: دي **فحص تهيئة** منفصل عن validateFormulaNode (اللي بيفحص شكل الشجرة) —
 * بنمشي على نفس الشجرة مرتين بأدوار مختلفة بدل ما نخلطهم في recursion واحد، لأن التحقق
 * الهيكلي بيحصل كمان من مسارات تانية (draft preview) مفيهاش سياق خدمة.
 */
export function collectFormulaReferences(payload: FinalPriceFormulaPayload): CollectedFormulaReference[] {
  const refs: CollectedFormulaReference[] = [];
  const seen = new Set<string>();

  const visitNode = (nodeRaw: unknown, path: string[]): void => {
    if (typeof nodeRaw !== 'object' || nodeRaw === null || Array.isArray(nodeRaw)) return;
    const node = nodeRaw as Record<string, unknown>;
    if (typeof node.type !== 'string') return;

    switch (node.type as FormulaNode['type']) {
      case 'field_ref': {
        const key = String(node.field_key ?? '');
        if (key && !seen.has(`f:${key}:${path.join('→')}`)) {
          refs.push({ kind: 'field', key, path: path.join(' → ') });
        }
        return;
      }
      case 'constant_ref': {
        const key = String(node.rule_key ?? '');
        if (key) refs.push({ kind: 'constant', key, path: path.join(' → ') });
        return;
      }
      case 'lookup_ref': {
        const key = String(node.rule_key ?? '');
        const bound = String(node.field_key ?? '');
        if (key) refs.push({ kind: 'lookup', key, extraKey: bound, path: path.join(' → ') });
        if (bound) refs.push({ kind: 'lookup_bound_field', key: bound, extraKey: key, path: `${path.join(' → ')} (ربط جدول البحث "${key}")` });
        return;
      }
      case 'percentage':
        visitNode(node.base, [...path, 'percentage.base']);
        visitNode(node.percent, [...path, 'percentage.percent']);
        return;
      case 'round':
      case 'ceil':
      case 'floor':
        visitNode(node.value, [...path, String(node.type)]);
        return;
      case 'if': {
        const cond = node.condition as Record<string, unknown> | undefined;
        if (cond && typeof cond.field_key === 'string') {
          refs.push({ kind: 'field', key: cond.field_key, path: `${path.join(' → ')} → if.condition` });
        }
        visitNode(node.then, [...path, 'if.then']);
        visitNode(node.else, [...path, 'if.else']);
        return;
      }
      default: {
        const operands = node.operands as unknown[] | undefined;
        if (Array.isArray(operands)) {
          operands.forEach((op, i) => visitNode(op, [...path, `${String(node.type)}.operands[${i}]`]));
        }
      }
    }
  };

  for (const key of ['price_cents', ...OPTIONAL_FORMULA_OUTPUT_KEYS] as (keyof FinalPriceFormulaPayload)[]) {
    if (payload[key] !== undefined) visitNode(payload[key], [String(key)]);
  }
  void seen;
  return refs;
}

// ===================== Trace (docs/01B §5) + شرح هيكلي (§6) =====================
// الاثنين للإدارة فقط — **مش مصدر تسعير**: القيمة النهائية بتتاخد دايمًا من
// evaluateFormulaNode العادية، والـtrace/الشرح مجرد عرض مساعد للأدمن.

export interface FormulaTraceEntry {
  /** مسار العقدة داخل الشجرة. */
  path: string;
  /** ملخص التعبير عند العقدة دي. */
  expression: string;
  /** الناتج الرقمي للعقدة. */
  value: number;
}

interface TracedEvaluation {
  value: number;
  entries: FormulaTraceEntry[];
}

/**
 * تقييم مع تسجيل خطوات الحساب — نفس دلالات evaluateFormulaNode بالحرف (نفس الفروع ونفس
 * رفض الحالات)، بس بيجمع قائمة خطوط "المتغير = قيمة" و"العملية = نتيجة" عشان الأدمن يفهم
 * إزاي السعر اتحسب. بيُستخدم في evaluateDraft بس.
 */
export function evaluateFormulaNodeWithTrace(
  node: FormulaNode,
  context: FormulaEvaluationContext,
): { value: number; trace: FormulaTraceEntry[] } {
  const entries: FormulaTraceEntry[] = [];
  let counter = 0;

  const evalTraced = (n: FormulaNode, path: string[]): number => {
    switch (n.type) {
      case 'field_ref': {
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({ path: path.join('.'), expression: `${n.field_key} = ${value}`, value });
        return value;
      }
      case 'constant_ref': {
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({ path: path.join('.'), expression: `${n.rule_key} = ${value}`, value });
        return value;
      }
      case 'lookup_ref': {
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({ path: path.join('.'), expression: `lookup:${n.rule_key} = ${value}`, value });
        return value;
      }
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':
      case 'min':
      case 'max': {
        const childValues = n.operands.map((op) => evalTraced(op, [...path, n.type]));
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({
          path: path.join('.'),
          expression: `${n.type}(${childValues.map((v) => String(v)).join(', ')}) = ${value}`,
          value,
        });
        return value;
      }
      case 'percentage': {
        const baseValue = evalTraced(n.base, [...path, 'base']);
        const percentValue = evalTraced(n.percent, [...path, 'percent']);
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({
          path: path.join('.'),
          expression: `${baseValue} ±${percentValue}% = ${value}`,
          value,
        });
        return value;
      }
      case 'round':
      case 'ceil':
      case 'floor': {
        const inner = evalTraced(n.value, [...path, n.type]);
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({ path: path.join('.'), expression: `${n.type}(${inner}) = ${value}`, value });
        return value;
      }
      case 'if': {
        const conditionResult = evaluateCondition(n.condition, context);
        counter += 1;
        entries.push({
          path: [...path, 'if.condition'].join('.'),
          expression: `${n.condition.field_key} ${n.condition.op} ${String(n.condition.value)} → ${conditionResult}`,
          value: conditionResult ? 1 : 0,
        });
        const branch = conditionResult ? n.then : n.else;
        return evalTraced(branch, [...path, conditionResult ? 'then' : 'else']);
      }
      default:
        // literal — مفيش سطر مفيد يتسجل عنده
        return evaluateFormulaNode(n, context);
    }
  };

  // ترتيب ما-بعد-التنفيذ الطبيعي: ربط الأوراق الأول ثم العمليات لأعلى لحد الناتج النهائي
  // (نفس ترتيب مثال docs/01B §5: hours=5 … final price=27500)
  const finalValue = evalTraced(node, ['price_cents']);
  void counter;
  return { value: finalValue, trace: entries };
}

/** شرح هيكلي سطري لكل مخرجات المعادلة — explanation-only، مش مصدر تسعير (docs/01B §6). */
export function describeFormulaPayload(payload: FinalPriceFormulaPayload): string[] {
  const lines: string[] = [];
  const summarize = (node: unknown): string => {
    if (typeof node !== 'object' || node === null) return '—';
    const n = node as Record<string, unknown>;
    switch (n.type) {
      case 'literal':
        return String(n.value);
      case 'field_ref':
        return `حقل «${String(n.field_key)}»`;
      case 'constant_ref':
        return `ثابت «${String(n.rule_key)}»`;
      case 'lookup_ref':
        return `جدول بحث «${String(n.rule_key)}»`;
      case 'percentage':
        return `نسبة على (${summarize(n.base)}) بنسبة (${summarize(n.percent)})%`;
      case 'round':
        return `تقريب (${summarize(n.value)})`;
      case 'ceil':
        return `تقريب لأعلى (${summarize(n.value)})`;
      case 'floor':
        return `تقريب لأسفل (${summarize(n.value)})`;
      case 'if': {
        const cond = n.condition as Record<string, unknown>;
        return `لو «${String(cond.field_key)}» ${String(cond.op)} «${String(cond.value)}» ف(${summarize(n.then)}) وإلا(${summarize(n.else)})`;
      }
      default: {
        const ops = Array.isArray(n.operands) ? (n.operands as unknown[]).map(summarize) : [];
        const joiner =
          n.type === 'multiply' ? ' × ' : n.type === 'divide' ? ' ÷ ' : n.type === 'add' ? ' + ' : ' − ';
        const label =
          n.type === 'multiply' ? 'ضرب' : n.type === 'divide' ? 'قسمة' : n.type === 'add' ? 'جمع' : n.type === 'subtract' ? 'طرح' : n.type === 'min' ? 'أصغر' : n.type === 'max' ? 'أكبر' : String(n.type);
        return `${label}(${ops.join(joiner)})`;
      }
    }
  };

  for (const key of ['price_cents', ...OPTIONAL_FORMULA_OUTPUT_KEYS] as (keyof FinalPriceFormulaPayload)[]) {
    if (payload[key] !== undefined) {
      lines.push(`${key}: ${summarize(payload[key])}`);
    }
  }
  return lines;
}
