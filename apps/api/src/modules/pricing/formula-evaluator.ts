import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { FORMULA_LIMITS } from './formula-limits';
import {
  ComparisonOperator,
  ConstantRulePayload,
  DateDiffRounding,
  DateDiffUnit,
  DistanceUnit,
  FinalPriceFormulaPayload,
  FormulaCondition,
  FormulaDateSource,
  FormulaGeoSource,
  FormulaNode,
  LookupTableRulePayload,
} from './pricing-formula.types';
import { dateDiff, GeoPoint, haversineKm } from './pricing-temporal';

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
  'date_diff',
  'distance',
]);

const ALLOWED_DATE_DIFF_UNITS = new Set<DateDiffUnit>(['minutes', 'hours', 'days', 'weeks', 'months']);
const ALLOWED_DATE_DIFF_ROUNDINGS = new Set<DateDiffRounding>(['exact', 'ceil', 'floor', 'round']);
const ALLOWED_DISTANCE_UNITS = new Set<DistanceUnit>(['km', 'm']);
const ALLOWED_DATE_SOURCE_KINDS = new Set<FormulaDateSource['kind']>([
  'field',
  'scheduled_at',
  'scheduled_end_at',
  'period_start',
  'period_end',
  'now',
]);
const ALLOWED_GEO_SOURCE_KINDS = new Set<FormulaGeoSource['kind']>(['field', 'order_location', 'point']);

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
    case 'date_diff':
      validateDateSource(candidate.from, `${currentPath(ctx)} → date_diff.from`);
      validateDateSource(candidate.to, `${currentPath(ctx)} → date_diff.to`);
      if (typeof candidate.unit !== 'string' || !ALLOWED_DATE_DIFF_UNITS.has(candidate.unit as DateDiffUnit)) {
        rejectFormula(`date_diff.unit غير مسموحة: ${String(candidate.unit)}`, currentPath(ctx));
      }
      if (
        candidate.rounding !== undefined &&
        (typeof candidate.rounding !== 'string' || !ALLOWED_DATE_DIFF_ROUNDINGS.has(candidate.rounding as DateDiffRounding))
      ) {
        rejectFormula(`date_diff.rounding غير مسموحة: ${String(candidate.rounding)}`, currentPath(ctx));
      }
      for (const flag of ['inclusive', 'absolute'] as const) {
        if (candidate[flag] !== undefined && typeof candidate[flag] !== 'boolean') {
          rejectFormula(`date_diff.${flag} لازم يكون boolean لو موجود`, currentPath(ctx));
        }
      }
      return;
    case 'distance':
      validateGeoSource(candidate.from, `${currentPath(ctx)} → distance.from`);
      validateGeoSource(candidate.to, `${currentPath(ctx)} → distance.to`);
      if (typeof candidate.unit !== 'string' || !ALLOWED_DISTANCE_UNITS.has(candidate.unit as DistanceUnit)) {
        rejectFormula(`distance.unit غير مسموحة: ${String(candidate.unit)}`, currentPath(ctx));
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

function validateDateSource(source: unknown, path: string): void {
  if (typeof source !== 'object' || source === null) {
    rejectFormula('مصدر التاريخ لازم يكون object', path);
  }
  const candidate = source as Record<string, unknown>;
  if (typeof candidate.kind !== 'string' || !ALLOWED_DATE_SOURCE_KINDS.has(candidate.kind as FormulaDateSource['kind'])) {
    rejectFormula(`مصدر تاريخ غير مسموح: ${String(candidate.kind)}`, path);
  }
  if (candidate.kind === 'field' && (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0)) {
    rejectFormula('مصدر التاريخ من نوع حقل لازم يحدد field_key', path);
  }
}

function validateGeoSource(source: unknown, path: string): void {
  if (typeof source !== 'object' || source === null) {
    rejectFormula('مصدر الموقع لازم يكون object', path);
  }
  const candidate = source as Record<string, unknown>;
  if (typeof candidate.kind !== 'string' || !ALLOWED_GEO_SOURCE_KINDS.has(candidate.kind as FormulaGeoSource['kind'])) {
    rejectFormula(`مصدر موقع غير مسموح: ${String(candidate.kind)}`, path);
  }
  if (candidate.kind === 'field' && (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0)) {
    rejectFormula('مصدر الموقع من نوع حقل لازم يحدد field_key', path);
  }
  if (candidate.kind === 'point') {
    const lat = candidate.lat;
    const lng = candidate.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      rejectFormula('النقطة الثابتة لازم يكون لها lat/lng صالحين', path);
    }
  }
}

export interface FormulaEvaluationContext {
  fieldValues: Record<string, string | number | boolean>;
  constants: Map<string, ConstantRulePayload>;
  lookupTables: Map<string, LookupTableRulePayload>;
  /**
   * التواريخ المتاحة للمعادلة (ADR-0050 §2). المفتاح إما `field:<field_key>` لحقل من الفورم، أو
   * اسم مصدر النظام (`scheduled_at`، `period_start`، …). `now` مابيتخزّنش هنا — بيتحسب لحظة
   * التقييم عشان نتيجة نفس السياق ماتبقاش معتمدة على متى اتبنى السياق.
   */
  dateValues?: Map<string, Date>;
  /** النقاط الجغرافية المتاحة (ADR-0050 §3) — نفس نظام المفاتيح. */
  geoPoints?: Map<string, GeoPoint>;
}

const OPTIONAL_FORMULA_OUTPUT_KEYS: (keyof FinalPriceFormulaPayload)[] = [
  'min_price_cents',
  'max_price_cents',
  'duration_minutes',
  'estimated_duration_days',
  'required_technicians',
  // ADR-0061 §5 — `requires_assistant` **اتشال من هنا بالكامل**، مش بيتجاهَل. مخرج مقبول في
  // الحفظ وبيتجاهَل وقت التقييم هو تاني مسار صامت بالظبط زي اللي المالك طلب شيله: الأدمن بيكتبه،
  // بيتحفظ، ومحصلش. رفضه صراحةً بيدّي رسالة واضحة إن `required_assistants` هو المكان.
  'required_assistants',
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

  // ADR-0061 §5 — أي مفتاح مش من المخرجات المعروفة **بيترفض**، مش بيتقبل ويتجاهَل.
  // ده مش تشدّد شكلي: مخرج بيتحفظ ومحدش بيقراه هو تاني مسار صامت لنفس المعنى (بالظبط اللي حصل
  // في `requires_assistant` قبل ما يتشال) — الأدمن بيكتبه، الواجهة بتوريه، ومحصلش أي أثر. غلطة
  // إملائية في اسم مخرج (`duration_minute`) كانت كمان بتعدّي بصمت وبتدّي حجز غلط.
  const knownKeys = new Set<string>(['price_cents', ...OPTIONAL_FORMULA_OUTPUT_KEYS]);
  const unknownKeys = Object.keys(payload).filter((key) => !knownKeys.has(key));
  if (unknownKeys.length > 0) {
    rejectFormula(
      `مخرجات مش معروفة في المعادلة: ${unknownKeys.join('، ')}. المسموح: ${[...knownKeys].join('، ')}`,
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

/** اسم عربي للمصدر — بيدخل في رسائل الرفض عشان الأدمن يعرف أنهي طرف ناقص بالظبط. */
const DATE_SOURCE_LABELS_AR: Record<FormulaDateSource['kind'], string> = {
  field: 'حقل من الفورم',
  scheduled_at: 'موعد بداية الخدمة',
  scheduled_end_at: 'موعد نهاية الخدمة',
  period_start: 'بداية الفترة',
  period_end: 'نهاية الفترة',
  now: 'وقت الحساب',
};

function dateSourceKey(source: FormulaDateSource): string {
  return source.kind === 'field' ? `field:${source.field_key}` : source.kind;
}

function resolveDateSource(source: FormulaDateSource, context: FormulaEvaluationContext): Date {
  // `now` بيتحسب لحظة التنفيذ مش وقت بناء السياق — سياق واحد ممكن يتقيّم أكتر من مرة.
  if (source.kind === 'now') return new Date();
  const value = context.dateValues?.get(dateSourceKey(source));
  if (!value) {
    const label = source.kind === 'field' ? `الحقل "${source.field_key}"` : DATE_SOURCE_LABELS_AR[source.kind];
    throw new ApiException(
      ErrorCode.VAL_001,
      `${label} مطلوب كتاريخ لحساب السعر — القيمة مش موجودة أو مش تاريخ صالح`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function resolveGeoSource(source: FormulaGeoSource, context: FormulaEvaluationContext): GeoPoint {
  if (source.kind === 'point') return { lat: source.lat, lng: source.lng };
  const key = source.kind === 'field' ? `field:${source.field_key}` : source.kind;
  const value = context.geoPoints?.get(key);
  if (!value) {
    const label = source.kind === 'field' ? `الحقل "${source.field_key}"` : 'موقع الطلب';
    throw new ApiException(
      ErrorCode.VAL_001,
      `${label} مطلوب كموقع لحساب السعر — القيمة مش موجودة أو مش إحداثيات صالحة`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
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
        // ADR-0050 §5 — حقل التاريخ/الموقع بيتقرا بعقدة مخصصة، مش كرقم. الرسالة بتسمّي البديل
        // بدل ما تقول "مش رقم" وخلاص: ده بالظبط الغلط اللي المالك بلّغ عنه (حقل تاريخ في الفورم
        // بلا أي استهلاك ممكن). ورجوع epoch ms كرقم **مرفوض عمدًا** — كان هيدّي سعر بالمليارات
        // بصمت لو الأدمن ضربه في تعريفة.
        const hint = context.dateValues?.has(`field:${node.field_key}`)
          ? ' — ده حقل تاريخ، استخدم عقدة «فرق بين تاريخين» بدل قراءته كرقم'
          : context.geoPoints?.has(`field:${node.field_key}`)
            ? ' — ده حقل موقع، استخدم عقدة «المسافة بين نقطتين»'
            : '';
        throw new ApiException(
          ErrorCode.VAL_001,
          `قيمة الحقل "${node.field_key}" لازم تكون رقم صالح لحساب السعر — القيمة الحالية غير رقمية${hint}`,
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

    case 'date_diff': {
      const from = resolveDateSource(node.from, context);
      const to = resolveDateSource(node.to, context);
      return dateDiff(from, to, {
        unit: node.unit,
        rounding: node.rounding,
        inclusive: node.inclusive,
        absolute: node.absolute,
      });
    }

    case 'distance': {
      const from = resolveGeoSource(node.from, context);
      const to = resolveGeoSource(node.to, context);
      const km = haversineKm(from, to);
      return node.unit === 'm' ? km * 1000 : km;
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
      case 'date_diff': {
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({
          path: path.join('.'),
          expression: `فرق التواريخ (${DATE_DIFF_UNIT_LABELS_AR[n.unit]}) = ${value}`,
          value,
        });
        return value;
      }
      case 'distance': {
        const value = evaluateFormulaNode(n, context);
        counter += 1;
        entries.push({
          path: path.join('.'),
          expression: `المسافة (${n.unit === 'm' ? 'متر' : 'كم'}) = ${value}`,
          value,
        });
        return value;
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

const DATE_DIFF_UNIT_LABELS_AR: Record<DateDiffUnit, string> = {
  minutes: 'دقايق',
  hours: 'ساعات',
  days: 'أيام',
  weeks: 'أسابيع',
  months: 'شهور',
};

function describeDateSource(source: unknown): string {
  if (typeof source !== 'object' || source === null) return '—';
  const candidate = source as Record<string, unknown>;
  if (candidate.kind === 'field') return `حقل «${String(candidate.field_key)}»`;
  return DATE_SOURCE_LABELS_AR[candidate.kind as FormulaDateSource['kind']] ?? String(candidate.kind);
}

function describeGeoSource(source: unknown): string {
  if (typeof source !== 'object' || source === null) return '—';
  const candidate = source as Record<string, unknown>;
  if (candidate.kind === 'field') return `حقل «${String(candidate.field_key)}»`;
  if (candidate.kind === 'point') return `نقطة ثابتة (${String(candidate.lat)}, ${String(candidate.lng)})`;
  return 'موقع الطلب';
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
      case 'date_diff': {
        const unit = DATE_DIFF_UNIT_LABELS_AR[n.unit as DateDiffUnit] ?? String(n.unit);
        const suffix = n.inclusive ? '، شامل الطرفين' : '';
        return `الفرق بالـ${unit} بين (${describeDateSource(n.from)}) و(${describeDateSource(n.to)})${suffix}`;
      }
      case 'distance':
        return `المسافة بالـ${n.unit === 'm' ? 'متر' : 'كم'} بين (${describeGeoSource(n.from)}) و(${describeGeoSource(n.to)})`;
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
