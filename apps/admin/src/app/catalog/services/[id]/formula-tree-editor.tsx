'use client';

// محرر شجرة المعادلة البصري (No-Code Formula Builder) — كانت فجوة موثّقة صراحة (docs/08 §1.8،
// P1): "المعادلة النهائية لسه JSON AST في textarea. تقنيًا آمن، لكن مش تجربة Super Admin
// احترافية." الحل هنا: نفس شجرة FormulaNode بالحرف (packages/shared-types/src/pricing.ts)،
// بس بمحرر شجري بصري recursive — كل عقدة كارت فيه اختيار نوع + عناصر تحكم مناسبة لنوعها، مفيش
// أي JSON ظاهر للأدمن خالص. الـJSON لسه هو التمثيل المُخزَّن فعليًا (payload)، بس داخلي مش مطلوب
// إدخاله يدويًا — الأدمن بيبني الشجرة بالعين بس.
//
// **قرار تصميم متعمّد**: مفيش drag & drop حقيقي (blocks تتسحب) — بديل أبسط وأسرع بناءً (recursive
// tree، كل مستوى Card فيه select نوع العقدة + عناصر تحكم فرعية حسب النوع)، بيحقق نفس الهدف
// (no-code كامل) بمخاطرة ومجهود أقل بكتير من drag & drop framework كامل. راجعت الأنواع المسموحة
// كلها في apps/api/src/modules/pricing/formula-evaluator.ts's ALLOWED_NODE_TYPES/validateFormulaNode
// قبل البناء — نفس الأنواع بالحرف، صفر اختراع.

import type { ComparisonOperator, FormulaCondition, FormulaNode } from '@baytak/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';

export interface FormulaEditorContext {
  fieldKeys: string[];
  constantKeys: string[];
  lookupTables: { ruleKey: string; fieldKey: string }[];
}

const NODE_TYPE_LABELS: Record<FormulaNode['type'], string> = {
  literal: 'رقم ثابت',
  field_ref: 'قيمة حقل من الفورم',
  constant_ref: 'ثابت معرّف',
  lookup_ref: 'قيمة من جدول بحث',
  add: 'جمع (+)',
  subtract: 'طرح (−)',
  multiply: 'ضرب (×)',
  divide: 'قسمة (÷)',
  percentage: 'نسبة مئوية',
  min: 'أصغر قيمة',
  max: 'أكبر قيمة',
  round: 'تقريب',
  if: 'شرط (لو... وإلا)',
};

const NODE_TYPES = Object.keys(NODE_TYPE_LABELS) as FormulaNode['type'][];

const COMPARISON_LABELS: Record<ComparisonOperator, string> = {
  equals: '=',
  not_equals: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

function defaultCondition(context: FormulaEditorContext): FormulaCondition {
  return { field_key: context.fieldKeys[0] ?? '', op: 'equals', value: '' };
}

// شجرة افتراضية معقولة لكل نوع عقدة — بتتستخدم لما الأدمن يغيّر نوع عقدة موجودة (بدل ما تفضل
// شكل النوع القديم غير المتوافق) أو يضيف عنصر جديد لقايمة operands.
function defaultNodeForType(type: FormulaNode['type'], context: FormulaEditorContext): FormulaNode {
  switch (type) {
    case 'literal':
      return { type: 'literal', value: 0 };
    case 'field_ref':
      return { type: 'field_ref', field_key: context.fieldKeys[0] ?? '' };
    case 'constant_ref':
      return { type: 'constant_ref', rule_key: context.constantKeys[0] ?? '' };
    case 'lookup_ref':
      return {
        type: 'lookup_ref',
        rule_key: context.lookupTables[0]?.ruleKey ?? '',
        field_key: context.lookupTables[0]?.fieldKey ?? '',
      };
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max':
      return { type, operands: [{ type: 'literal', value: 0 }] };
    case 'percentage':
      return { type: 'percentage', base: { type: 'literal', value: 0 }, percent: { type: 'literal', value: 0 } };
    case 'round':
      return { type: 'round', value: { type: 'literal', value: 0 }, decimals: 0 };
    case 'if':
      return {
        type: 'if',
        condition: defaultCondition(context),
        then: { type: 'literal', value: 0 },
        else: { type: 'literal', value: 0 },
      };
  }
}

export function FormulaTreeEditor({
  node,
  onChange,
  context,
  depth = 0,
}: {
  node: FormulaNode;
  onChange: (node: FormulaNode) => void;
  context: FormulaEditorContext;
  depth?: number;
}) {
  function handleTypeChange(newType: FormulaNode['type']) {
    if (newType === node.type) return;
    onChange(defaultNodeForType(newType, context));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2" style={{ marginInlineStart: depth > 0 ? 4 : 0 }}>
      <SelectNative
        value={node.type}
        onChange={(e) => handleTypeChange(e.target.value as FormulaNode['type'])}
        className="w-fit"
      >
        {NODE_TYPES.map((t) => (
          <option key={t} value={t}>
            {NODE_TYPE_LABELS[t]}
          </option>
        ))}
      </SelectNative>

      {node.type === 'literal' && (
        <Input
          type="number"
          value={node.value}
          onChange={(e) => onChange({ type: 'literal', value: Number(e.target.value) })}
          dir="ltr"
        />
      )}

      {node.type === 'field_ref' && (
        <SelectNative value={node.field_key} onChange={(e) => onChange({ type: 'field_ref', field_key: e.target.value })}>
          {context.fieldKeys.length === 0 && <option value="">— مفيش حقول متاحة —</option>}
          {context.fieldKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </SelectNative>
      )}

      {node.type === 'constant_ref' && (
        <SelectNative value={node.rule_key} onChange={(e) => onChange({ type: 'constant_ref', rule_key: e.target.value })}>
          {context.constantKeys.length === 0 && <option value="">— مفيش ثوابت متاحة —</option>}
          {context.constantKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </SelectNative>
      )}

      {node.type === 'lookup_ref' && (
        <SelectNative
          value={node.rule_key}
          onChange={(e) => {
            const table = context.lookupTables.find((t) => t.ruleKey === e.target.value);
            onChange({ type: 'lookup_ref', rule_key: e.target.value, field_key: table?.fieldKey ?? '' });
          }}
        >
          {context.lookupTables.length === 0 && <option value="">— مفيش جداول بحث متاحة —</option>}
          {context.lookupTables.map((t) => (
            <option key={t.ruleKey} value={t.ruleKey}>
              {t.ruleKey} (حقل: {t.fieldKey})
            </option>
          ))}
        </SelectNative>
      )}

      {(node.type === 'add' ||
        node.type === 'subtract' ||
        node.type === 'multiply' ||
        node.type === 'divide' ||
        node.type === 'min' ||
        node.type === 'max') && (
        <div className="flex flex-col gap-2">
          {node.operands.map((operand, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <FormulaTreeEditor
                  node={operand}
                  onChange={(next) => {
                    const operands = [...node.operands];
                    operands[i] = next;
                    onChange({ ...node, operands });
                  }}
                  context={context}
                  depth={depth + 1}
                />
              </div>
              {node.operands.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ ...node, operands: node.operands.filter((_, idx) => idx !== i) })}
                >
                  حذف
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => onChange({ ...node, operands: [...node.operands, { type: 'literal', value: 0 }] })}
          >
            + إضافة عنصر
          </Button>
        </div>
      )}

      {node.type === 'percentage' && (
        <div className="flex flex-col gap-2">
          <div>
            <Label className="mb-1 block">الأساس</Label>
            <FormulaTreeEditor node={node.base} onChange={(n) => onChange({ ...node, base: n })} context={context} depth={depth + 1} />
          </div>
          <div>
            <Label className="mb-1 block">النسبة % (موجب = زيادة، سالب = نقصان)</Label>
            <FormulaTreeEditor
              node={node.percent}
              onChange={(n) => onChange({ ...node, percent: n })}
              context={context}
              depth={depth + 1}
            />
          </div>
        </div>
      )}

      {node.type === 'round' && (
        <div className="flex flex-col gap-2">
          <div>
            <Label className="mb-1 block">القيمة</Label>
            <FormulaTreeEditor node={node.value} onChange={(n) => onChange({ ...node, value: n })} context={context} depth={depth + 1} />
          </div>
          <div>
            <Label className="mb-1 block">عدد الخانات العشرية</Label>
            <Input
              type="number"
              min={0}
              value={node.decimals ?? 0}
              onChange={(e) => onChange({ ...node, decimals: Number(e.target.value) })}
              dir="ltr"
            />
          </div>
        </div>
      )}

      {node.type === 'if' && (
        <div className="flex flex-col gap-2">
          <Label className="mb-1 block">الشرط</Label>
          <div className="flex flex-wrap gap-2">
            <SelectNative
              className="w-auto"
              value={node.condition.field_key}
              onChange={(e) => onChange({ ...node, condition: { ...node.condition, field_key: e.target.value } })}
            >
              {context.fieldKeys.length === 0 && <option value="">— مفيش حقول —</option>}
              {context.fieldKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </SelectNative>
            <SelectNative
              className="w-auto"
              value={node.condition.op}
              onChange={(e) =>
                onChange({ ...node, condition: { ...node.condition, op: e.target.value as ComparisonOperator } })
              }
            >
              {(Object.entries(COMPARISON_LABELS) as [ComparisonOperator, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectNative>
            <Input
              className="w-32"
              value={String(node.condition.value)}
              onChange={(e) => onChange({ ...node, condition: { ...node.condition, value: e.target.value } })}
              dir="ltr"
            />
          </div>
          <div>
            <Label className="mb-1 block">لو تحقق الشرط</Label>
            <FormulaTreeEditor node={node.then} onChange={(n) => onChange({ ...node, then: n })} context={context} depth={depth + 1} />
          </div>
          <div>
            <Label className="mb-1 block">لو ما تحققش</Label>
            <FormulaTreeEditor node={node.else} onChange={(n) => onChange({ ...node, else: n })} context={context} depth={depth + 1} />
          </div>
        </div>
      )}
    </div>
  );
}
