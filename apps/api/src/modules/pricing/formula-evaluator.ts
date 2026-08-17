import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  ComparisonOperator,
  ConstantRulePayload,
  FormulaCondition,
  FormulaNode,
  LookupTableRulePayload,
} from './pricing-formula.types';

// أقصى عمق لشجرة المعادلة — دفاع ضد أشجار متداخلة بشكل مرضي (تعمل stack overflow أو DoS)،
// مش قيمة عمل بيختارها الأدمن. 12 مستوى كافي جدًا لأي معادلة تسعير واقعية (راجع الأمثلة في
// docs/08 §1.8 — أعمقها 3-4 مستويات).
const MAX_FORMULA_DEPTH = 12;

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

function rejectFormula(reason: string): never {
  throw new ApiException(ErrorCode.VAL_001, `معادلة تسعير غير صالحة: ${reason}`, HttpStatus.BAD_REQUEST);
}

/**
 * بيتنادى وقت حفظ المعادلة من الأدمن (مش وقت تنفيذها على العميل) — بيتأكد إن الشجرة كلها
 * بتستخدم بس العمليات المسموحة (`ALLOWED_NODE_TYPES`) وإن عمقها معقول. أي عملية برّه القايمة
 * دي بترفض هنا فورًا، قبل ما تتخزن في service_pricing_rules.payload خالص — راجع
 * docs/adr/0001-dynamic-pricing-engine.md للسبب الأمني الكامل.
 */
export function validateFormulaNode(node: unknown, depth = 0): void {
  if (depth > MAX_FORMULA_DEPTH) {
    rejectFormula(`الشجرة أعمق من الحد المسموح (${MAX_FORMULA_DEPTH} مستوى)`);
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    rejectFormula('كل عقدة لازم تكون object');
  }
  const candidate = node as Record<string, unknown>;
  const type = candidate.type;
  if (typeof type !== 'string' || !ALLOWED_NODE_TYPES.has(type as FormulaNode['type'])) {
    rejectFormula(`نوع عقدة غير مسموح: ${String(type)}`);
  }

  switch (type as FormulaNode['type']) {
    case 'literal':
      if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) {
        rejectFormula('literal.value لازم يكون رقم');
      }
      return;
    case 'field_ref':
      if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
        rejectFormula('field_ref.field_key لازم يكون نص غير فاضي');
      }
      return;
    case 'constant_ref':
      if (typeof candidate.rule_key !== 'string' || candidate.rule_key.length === 0) {
        rejectFormula('constant_ref.rule_key لازم يكون نص غير فاضي');
      }
      return;
    case 'lookup_ref':
      if (typeof candidate.rule_key !== 'string' || candidate.rule_key.length === 0) {
        rejectFormula('lookup_ref.rule_key لازم يكون نص غير فاضي');
      }
      if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
        rejectFormula('lookup_ref.field_key لازم يكون نص غير فاضي');
      }
      return;
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max': {
      if (!Array.isArray(candidate.operands) || candidate.operands.length < 1) {
        rejectFormula(`${type}.operands لازم تكون مصفوفة فيها عنصر واحد على الأقل`);
      }
      for (const operand of candidate.operands as unknown[]) {
        validateFormulaNode(operand, depth + 1);
      }
      return;
    }
    case 'percentage':
      validateFormulaNode(candidate.base, depth + 1);
      validateFormulaNode(candidate.percent, depth + 1);
      return;
    case 'round':
    case 'ceil':
    case 'floor':
      validateFormulaNode(candidate.value, depth + 1);
      if (candidate.decimals !== undefined && typeof candidate.decimals !== 'number') {
        rejectFormula(`${candidate.type}.decimals لازم يكون رقم لو موجود`);
      }
      return;
    case 'if':
      validateFormulaCondition(candidate.condition);
      validateFormulaNode(candidate.then, depth + 1);
      validateFormulaNode(candidate.else, depth + 1);
      return;
  }
}

function validateFormulaCondition(condition: unknown): void {
  if (typeof condition !== 'object' || condition === null) {
    rejectFormula('if.condition لازم يكون object');
  }
  const candidate = condition as Record<string, unknown>;
  if (typeof candidate.field_key !== 'string' || candidate.field_key.length === 0) {
    rejectFormula('condition.field_key لازم يكون نص غير فاضي');
  }
  if (typeof candidate.op !== 'string' || !ALLOWED_COMPARISON_OPERATORS.has(candidate.op as ComparisonOperator)) {
    rejectFormula(`condition.op غير مسموح: ${String(candidate.op)}`);
  }
  const valueType = typeof candidate.value;
  if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
    rejectFormula('condition.value لازم يكون نص أو رقم أو boolean');
  }
}

export interface FormulaEvaluationContext {
  fieldValues: Record<string, string | number | boolean>;
  constants: Map<string, ConstantRulePayload>;
  lookupTables: Map<string, LookupTableRulePayload>;
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
 * يرجع NaN أو يكسر بصمت.
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
      return Number(toComparableNumber(value));
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
