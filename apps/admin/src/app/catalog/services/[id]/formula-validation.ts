import type { FormulaNode } from '@baytak/shared-types';
import { FORMULA_LIMITS } from '@baytak/shared-types';
import type { FormulaEditorContext } from './formula-tree-editor';

export interface FormulaValidationIssue {
  path: string;
  message: string;
}

const NODE_TYPES = new Set<FormulaNode['type']>([
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

const OUTPUT_KEYS = new Set([
  'price_cents',
  'min_price_cents',
  'max_price_cents',
  'duration_minutes',
  'estimated_duration_days',
  'required_technicians',
  'required_assistants',
  'suitable_for_emergency',
]);

const COMPARISON_OPERATORS = new Set(['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte']);
const DATE_SOURCE_KINDS = new Set(['field', 'scheduled_at', 'scheduled_end_at', 'period_start', 'period_end', 'now']);
const GEO_SOURCE_KINDS = new Set(['field', 'order_location', 'point']);
const DATE_UNITS = new Set(['minutes', 'hours', 'days', 'weeks', 'months']);
const DATE_ROUNDINGS = new Set(['exact', 'ceil', 'floor', 'round']);
const DISTANCE_UNITS = new Set(['km', 'm']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A narrow guard for rendering. Full semantic validation remains in collectFormulaPayloadIssues. */
export function isFormulaNodeShape(value: unknown): value is FormulaNode {
  return isRecord(value) && typeof value.type === 'string' && NODE_TYPES.has(value.type as FormulaNode['type']);
}

function describePath(path: string[]): string {
  return path.join(' → ');
}

/**
 * Client-side, non-throwing validation for the advanced JSON editor. It deliberately mirrors the
 * API allow-list so an admin gets every repairable problem at once instead of a runtime error.
 * The API remains the final authority at save/evaluation time.
 */
export function collectFormulaPayloadIssues(payload: unknown, context: FormulaEditorContext): FormulaValidationIssue[] {
  const issues: FormulaValidationIssue[] = [];
  const add = (path: string[], message: string) => issues.push({ path: describePath(path), message });

  if (!isRecord(payload)) {
    add(['المعادلة'], 'المعادلة لازم تكون كائن JSON يحتوي على price_cents.');
    return issues;
  }

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes > FORMULA_LIMITS.MAX_PAYLOAD_JSON_BYTES) {
      add(['المعادلة'], `حجم المعادلة (${bytes} بايت) أكبر من الحد المسموح (${FORMULA_LIMITS.MAX_PAYLOAD_JSON_BYTES} بايت).`);
    }
  } catch {
    add(['المعادلة'], 'المعادلة لا يمكن تحويلها إلى JSON صالح.');
  }

  const unknownOutputs = Object.keys(payload).filter((key) => !OUTPUT_KEYS.has(key));
  for (const key of unknownOutputs) {
    add([key], 'هذا مخرج غير معروف. احذفه أو استخدم اسم مخرج معتمد.');
  }
  if (payload.price_cents === undefined) add(['price_cents'], 'السعر النهائي إجباري.');

  let nodeCount = 0;
  const validateField = (value: unknown, path: string[], label: string) => {
    if (typeof value !== 'string' || value.trim() === '') {
      add(path, `${label} لازم يكون اسم حقل غير فارغ.`);
    } else if (!context.fieldKeys.includes(value)) {
      add(path, `الحقل "${value}" غير موجود أو غير نشط في نموذج الخدمة.`);
    }
  };
  const validateDateSource = (source: unknown, path: string[]) => {
    if (!isRecord(source)) {
      add(path, 'مصدر التاريخ لازم يكون كائنًا صالحًا.');
      return;
    }
    if (typeof source.kind !== 'string' || !DATE_SOURCE_KINDS.has(source.kind)) {
      add(path, 'نوع مصدر التاريخ غير مدعوم.');
      return;
    }
    if (source.kind === 'field') validateField(source.field_key, [...path, 'field_key'], 'حقل التاريخ');
  };
  const validateGeoSource = (source: unknown, path: string[]) => {
    if (!isRecord(source)) {
      add(path, 'مصدر الموقع لازم يكون كائنًا صالحًا.');
      return;
    }
    if (typeof source.kind !== 'string' || !GEO_SOURCE_KINDS.has(source.kind)) {
      add(path, 'نوع مصدر الموقع غير مدعوم.');
      return;
    }
    if (source.kind === 'field') validateField(source.field_key, [...path, 'field_key'], 'حقل الموقع');
    if (source.kind === 'point') {
      if (typeof source.lat !== 'number' || !Number.isFinite(source.lat) || Math.abs(source.lat) > 90) {
        add([...path, 'lat'], 'خط العرض لازم يكون رقمًا بين -90 و90.');
      }
      if (typeof source.lng !== 'number' || !Number.isFinite(source.lng) || Math.abs(source.lng) > 180) {
        add([...path, 'lng'], 'خط الطول لازم يكون رقمًا بين -180 و180.');
      }
    }
  };
  const validateNode = (node: unknown, path: string[], depth: number): void => {
    if (depth > FORMULA_LIMITS.MAX_DEPTH) {
      add(path, `عمق المعادلة تعدّى الحد المسموح (${FORMULA_LIMITS.MAX_DEPTH}).`);
      return;
    }
    if (nodeCount >= FORMULA_LIMITS.MAX_NODE_COUNT) {
      add(path, `عدد عناصر المعادلة تعدّى الحد المسموح (${FORMULA_LIMITS.MAX_NODE_COUNT}).`);
      return;
    }
    if (!isRecord(node)) {
      add(path, 'العقدة ناقصة أو ليست كائن JSON. اختر نوعًا صالحًا لإصلاحها.');
      return;
    }
    nodeCount += 1;
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type as FormulaNode['type'])) {
      add([...path, 'type'], `نوع العقدة "${String(node.type)}" غير مدعوم.`);
      return;
    }

    switch (node.type as FormulaNode['type']) {
      case 'literal':
        if (typeof node.value !== 'number' || !Number.isFinite(node.value)) add([...path, 'value'], 'القيمة الثابتة لازم تكون رقمًا صالحًا.');
        return;
      case 'field_ref':
        validateField(node.field_key, [...path, 'field_key'], 'الحقل');
        return;
      case 'constant_ref':
        if (typeof node.rule_key !== 'string' || node.rule_key.trim() === '') add([...path, 'rule_key'], 'اسم الثابت مطلوب.');
        else if (!context.constantKeys.includes(node.rule_key)) add([...path, 'rule_key'], `الثابت "${node.rule_key}" غير موجود أو غير نشط.`);
        return;
      case 'lookup_ref': {
        if (typeof node.rule_key !== 'string' || node.rule_key.trim() === '') add([...path, 'rule_key'], 'اسم جدول البحث مطلوب.');
        const table = typeof node.rule_key === 'string' ? context.lookupTables.find((item) => item.ruleKey === node.rule_key) : undefined;
        if (!table) add([...path, 'rule_key'], `جدول البحث "${String(node.rule_key ?? '')}" غير موجود أو غير نشط.`);
        if (typeof node.field_key !== 'string' || node.field_key.trim() === '') add([...path, 'field_key'], 'الحقل المرتبط بجدول البحث مطلوب.');
        else if (table && table.fieldKey !== node.field_key) add([...path, 'field_key'], `الحقل لازم يطابق "${table.fieldKey}" المرتبط بالجدول.`);
        return;
      }
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':
      case 'min':
      case 'max':
        if (!Array.isArray(node.operands) || node.operands.length === 0) {
          add([...path, 'operands'], 'القائمة لازم تحتوي على عنصر واحد على الأقل.');
          return;
        }
        node.operands.forEach((operand, index) => validateNode(operand, [...path, `operands[${index}]`], depth + 1));
        return;
      case 'percentage':
        validateNode(node.base, [...path, 'base'], depth + 1);
        validateNode(node.percent, [...path, 'percent'], depth + 1);
        return;
      case 'round':
      case 'ceil':
      case 'floor':
        validateNode(node.value, [...path, 'value'], depth + 1);
        if (node.decimals !== undefined && (typeof node.decimals !== 'number' || !Number.isInteger(node.decimals) || node.decimals < 0 || node.decimals > 12)) {
          add([...path, 'decimals'], 'عدد الخانات العشرية لازم يكون عددًا صحيحًا من 0 إلى 12.');
        }
        return;
      case 'if': {
        if (!isRecord(node.condition)) {
          add([...path, 'condition'], 'الشرط لازم يكون كائنًا صالحًا.');
        } else {
          validateField(node.condition.field_key, [...path, 'condition', 'field_key'], 'حقل الشرط');
          if (typeof node.condition.op !== 'string' || !COMPARISON_OPERATORS.has(node.condition.op)) add([...path, 'condition', 'op'], 'عامل المقارنة غير مدعوم.');
          if (!['string', 'number', 'boolean'].includes(typeof node.condition.value) || (typeof node.condition.value === 'number' && !Number.isFinite(node.condition.value))) {
            add([...path, 'condition', 'value'], 'قيمة الشرط لازم تكون نصًا أو رقمًا صالحًا أو صح/خطأ.');
          }
        }
        validateNode(node.then, [...path, 'then'], depth + 1);
        validateNode(node.else, [...path, 'else'], depth + 1);
        return;
      }
      case 'date_diff':
        validateDateSource(node.from, [...path, 'from']);
        validateDateSource(node.to, [...path, 'to']);
        if (typeof node.unit !== 'string' || !DATE_UNITS.has(node.unit)) add([...path, 'unit'], 'وحدة فرق التاريخ غير مدعومة.');
        if (node.rounding !== undefined && (typeof node.rounding !== 'string' || !DATE_ROUNDINGS.has(node.rounding))) add([...path, 'rounding'], 'طريقة التقريب غير مدعومة.');
        for (const flag of ['inclusive', 'absolute']) if (node[flag] !== undefined && typeof node[flag] !== 'boolean') add([...path, flag], 'القيمة لازم تكون صح أو خطأ.');
        return;
      case 'distance':
        validateGeoSource(node.from, [...path, 'from']);
        validateGeoSource(node.to, [...path, 'to']);
        if (typeof node.unit !== 'string' || !DISTANCE_UNITS.has(node.unit)) add([...path, 'unit'], 'وحدة المسافة غير مدعومة.');
        return;
    }
  };

  for (const key of OUTPUT_KEYS) if (payload[key] !== undefined) validateNode(payload[key], [key], 0);
  return issues;
}
