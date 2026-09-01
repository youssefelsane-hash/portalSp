'use client';

// محرر شجرة المعادلة البصري (No-Code Formula Builder) — كانت فجوة موثّقة صراحة (docs/08 §1.8،
// P1): "المعادلة النهائية لسه JSON AST في textarea. تقنيًا آمن، لكن مش تجربة Super Admin
// احترافية." الحل هنا: نفس شجرة FormulaNode بالحرف (packages/shared-types/src/pricing.ts)،
// بس بمحرر شجري بصري recursive — كل عقدة كارت فيه اختيار نوع + عناصر تحكم مناسبة لنوعها، مفيش
// أي JSON ظاهر للأدمن خالص. الـJSON لسه هو التمثيل المُخزَّن فعليًا (payload)، بس داخلي مش مطلوب
// إدخاله يدويًا — الأدمن بيبني الشجرة بالعين بس.
//
// **تحديث docs/01B §4 (2026-08-24)**: للمعادلات العميقة (حتى 48 مستوى) اتضافت:
// - **Collapse/Expand**: كل عقدة تركيبية بتتطوي لسطر ملخص مفهوم ("ضرب: hours × 100").
// - **Breadcrumb**: الضغط على ⌖ في أي عقدة بيحدّث مسارها الكامل فوق المحرر (عبر onNavigate).
// - **Depth badge**: كل عقدة عميقة بتعرض عمقها الحالي مقابل الحد، بلون تحذير قرب الحد.
// - حدود الأرقام من FORMULA_LIMITS (shared) — مصدر واحد مع الباك-إند.
//
// **قرار تصميم متعمّد**: مفيش drag & drop حقيقي (blocks تتسحب) — بديل أبسط وأسرع بناءً (recursive
// tree، كل مستوى Card فيه select نوع العقدة + عناصر تحكم فرعية حسب النوع)، بيحقق نفس الهدف
// (no-code كامل) بمخاطرة ومجهود أقل بكتير من drag & drop framework كامل.

import { useState } from 'react';
import type {
  ComparisonOperator,
  DateDiffRounding,
  DateDiffUnit,
  DistanceUnit,
  FormulaCondition,
  FormulaDateSource,
  FormulaGeoSource,
  FormulaNode,
} from '@baytak/shared-types';
import { FORMULA_LIMITS } from '@baytak/shared-types';
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
  ceil: 'تقريب لأعلى (أي جزء من الوحدة = وحدة كاملة)',
  floor: 'تقريب لأسفل',
  if: 'شرط (لو... وإلا)',
  // ADR-0050 §2/§3 — الطريقة الوحيدة لاستهلاك حقول التاريخ/الموقع جوّه المعادلة.
  date_diff: 'فرق بين تاريخين (يوم/أسبوع/شهر/ساعة)',
  distance: 'المسافة بين نقطتين',
};

const DATE_DIFF_UNIT_LABELS: Record<DateDiffUnit, string> = {
  minutes: 'دقايق',
  hours: 'ساعات',
  days: 'أيام',
  weeks: 'أسابيع',
  months: 'شهور',
};

const DATE_DIFF_ROUNDING_LABELS: Record<DateDiffRounding, string> = {
  exact: 'بالكسور زي ما هي',
  ceil: 'لأعلى (أي جزء = وحدة كاملة)',
  floor: 'لأسفل (الوحدات الكاملة بس)',
  round: 'لأقرب وحدة',
};

const DISTANCE_UNIT_LABELS: Record<DistanceUnit, string> = { km: 'كيلومتر', m: 'متر' };

const SYSTEM_DATE_SOURCES: { kind: Exclude<FormulaDateSource['kind'], 'field'>; label: string }[] = [
  { kind: 'period_start', label: 'بداية الفترة (اشتراك/إيجار)' },
  { kind: 'period_end', label: 'نهاية الفترة (اشتراك/إيجار)' },
  { kind: 'scheduled_at', label: 'موعد بداية الزيارة' },
  { kind: 'scheduled_end_at', label: 'موعد نهاية الزيارة' },
  { kind: 'now', label: 'وقت الحساب دلوقتي' },
];

/** قيمة الـselect للمصدر — سلسلة واحدة عشان `<option>` يقدر يحملها. */
function dateSourceValue(source: FormulaDateSource): string {
  return source.kind === 'field' ? `field:${source.field_key}` : source.kind;
}

function parseDateSourceValue(raw: string): FormulaDateSource {
  if (raw.startsWith('field:')) return { kind: 'field', field_key: raw.slice('field:'.length) };
  return { kind: raw as Exclude<FormulaDateSource['kind'], 'field'> };
}

function geoSourceValue(source: FormulaGeoSource): string {
  return source.kind === 'field' ? `field:${source.field_key}` : source.kind;
}

function parseGeoSourceValue(raw: string, previous: FormulaGeoSource): FormulaGeoSource {
  if (raw.startsWith('field:')) return { kind: 'field', field_key: raw.slice('field:'.length) };
  if (raw === 'point') {
    return previous.kind === 'point' ? previous : { kind: 'point', lat: 30.0444, lng: 31.2357 };
  }
  return { kind: 'order_location' };
}

const NODE_TYPES = Object.keys(NODE_TYPE_LABELS) as FormulaNode['type'][];

const COMPARISON_LABELS: Record<ComparisonOperator, string> = {
  equals: '=',
  not_equals: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

/** ملخص سطر واحد لأي عقدة — بيظهر لما العقدة تتطوي. شرح هيكلي فقط (مش مصدر تسعير). */
export function nodeSummary(node: FormulaNode, context: FormulaEditorContext): string {
  const key = (k: string | undefined) => k ?? '—';
  switch (node.type) {
    case 'literal':
      return String(node.value);
    case 'field_ref':
      return `الحقل ${key(node.field_key)}`;
    case 'constant_ref':
      return `الثابت ${key(node.rule_key)}`;
    case 'lookup_ref':
      return `جدول ${key(node.rule_key)}`;
    case 'percentage':
      return `نسبة: (${nodeSummary(node.base, context)}) ±${nodeSummary(node.percent, context)}%`;
    case 'round':
      return `تقريب(${nodeSummary(node.value, context)})`;
    case 'ceil':
      return `تقريب لأعلى(${nodeSummary(node.value, context)})`;
    case 'floor':
      return `تقريب لأسفل(${nodeSummary(node.value, context)})`;
    case 'if':
      return `لو ${key(node.condition.field_key)} ${COMPARISON_LABELS[node.condition.op]} ${String(node.condition.value)} ؟`;
    case 'date_diff':
      return `فرق بالـ${DATE_DIFF_UNIT_LABELS[node.unit]}${node.inclusive ? ' (شامل)' : ''}`;
    case 'distance':
      return `مسافة بالـ${DISTANCE_UNIT_LABELS[node.unit]}`;
    default: {
      const parts = node.operands.map((o) => nodeSummary(o, context));
      const joiner =
        node.type === 'multiply' ? ' × ' : node.type === 'divide' ? ' ÷ ' : node.type === 'add' ? ' + ' : node.type === 'subtract' ? ' − ' : ' / ';
      const joined = parts.slice(0, 3).join(joiner) + (parts.length > 3 ? `${joiner}…` : '');
      return node.type === 'min' ? `أصغر(${joined})` : node.type === 'max' ? `أكبر(${joined})` : joined;
    }
  }
}

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
    case 'ceil':
    case 'floor':
      return { type, value: { type: 'literal', value: 0 }, decimals: 0 };
    case 'if':
      return {
        type: 'if',
        condition: defaultCondition(context),
        then: { type: 'literal', value: 0 },
        else: { type: 'literal', value: 0 },
      };
    // الافتراضي هو حالة الاستخدام اللي البلاغ كان عليها: عدد شهور الفوترة بين بداية ونهاية الفترة.
    case 'date_diff':
      return {
        type: 'date_diff',
        from: { kind: 'period_start' },
        to: { kind: 'period_end' },
        unit: 'months',
        rounding: 'ceil',
      };
    case 'distance':
      return {
        type: 'distance',
        from: { kind: 'order_location' },
        to: { kind: 'point', lat: 30.0444, lng: 31.2357 },
        unit: 'km',
      };
  }
}

const COMPOUND_TYPES = new Set<FormulaNode['type']>(['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'percentage', 'round', 'ceil', 'floor', 'if']);

function depthBadgeClass(edgeDepth: number): string {
  // تحذير بصري قرب الحد (≥85%) — من غير منع قبل الحد الفعلي (docs/01B §4)
  const ratio = edgeDepth / FORMULA_LIMITS.MAX_DEPTH;
  if (ratio >= 1) return 'bg-destructive text-destructive-foreground';
  if (ratio >= 0.85) return 'bg-orange-500 text-white';
  if (ratio >= 0.6) return 'bg-amber-200 text-amber-900';
  return 'bg-muted text-muted-foreground';
}

export function FormulaTreeEditor({
  node,
  onChange,
  context,
  depth = 0,
  path = [],
  onNavigate,
}: {
  node: FormulaNode;
  onChange: (node: FormulaNode) => void;
  context: FormulaEditorContext;
  depth?: number;
  /** مسار العقدة من الجذر — للـbreadcrumb ولعرض العمق الصحيح. */
  path?: string[];
  /** بيتنادى لما الأدمن يختار عقدة — عشان شريط المسار فوق المحرر يتحدث. */
  onNavigate?: (path: string[]) => void;
}) {
  // العقد التركيبية العميقة تبدأ مطوية تلقائيًا بعد المستوى السادس — توفير مساحة بلا إخفاء قدرات
  const [collapsed, setCollapsed] = useState(() => COMPOUND_TYPES.has(node.type) && depth >= 6);

  function handleTypeChange(newType: FormulaNode['type']) {
    if (newType === node.type) return;
    onChange(defaultNodeForType(newType, context));
  }

  const isCompound = COMPOUND_TYPES.has(node.type);
  const nearLimit = depth >= Math.ceil(FORMULA_LIMITS.MAX_DEPTH * 0.85);
  const overLimit = depth > FORMULA_LIMITS.MAX_DEPTH;

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-2 ${
        overLimit ? 'border-destructive bg-destructive/10' : nearLimit ? 'border-orange-400 bg-muted/30' : 'bg-muted/30'
      }`}
      style={{ marginInlineStart: depth > 0 ? 4 : 0 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isCompound && (
          <button
            type="button"
            className="w-6 rounded border px-1 text-xs hover:bg-accent"
            title={collapsed ? 'توسيع' : 'طي'}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        {!collapsed && (
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
        )}
        {depth >= 6 && (
          <span className={`rounded px-1.5 py-0.5 text-xs ${depthBadgeClass(depth)}`} title="عمق العقدة مقابل الحد الأقصى">
            {depth}/{FORMULA_LIMITS.MAX_DEPTH}
          </span>
        )}
        {onNavigate && (
          <button
            type="button"
            className="ms-auto text-xs text-muted-foreground hover:text-foreground"
            title="إظهار مسار العقدة دي في شريط التنقل"
            onClick={() => onNavigate([...path, node.type])}
          >
            ⌖
          </button>
        )}
      </div>

      {/* الملخص المطوي — شرح هيكلي بس، مش مصدر تسعير */}
      {collapsed && (
        <button
          type="button"
          className="flex items-center gap-2 rounded bg-background px-2 py-1 text-start text-sm hover:bg-accent"
          onClick={() => setCollapsed(false)}
        >
          <span className="font-medium">{NODE_TYPE_LABELS[node.type]}</span>
          <span className="text-muted-foreground">= {nodeSummary(node, context)}</span>
        </button>
      )}

      {!collapsed && (
        <>
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
                      path={[...path, node.type, `operands[${i}]`]}
                      onNavigate={onNavigate}
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
                disabled={depth + 1 > FORMULA_LIMITS.MAX_DEPTH}
                title={depth + 1 > FORMULA_LIMITS.MAX_DEPTH ? 'وصلت للحد الأقصى للعمق' : undefined}
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
                <FormulaTreeEditor
                  node={node.base}
                  onChange={(n) => onChange({ ...node, base: n })}
                  context={context}
                  depth={depth + 1}
                  path={[...path, node.type, 'base']}
                  onNavigate={onNavigate}
                />
              </div>
              <div>
                <Label className="mb-1 block">النسبة % (موجب = زيادة، سالب = نقصان)</Label>
                <FormulaTreeEditor
                  node={node.percent}
                  onChange={(n) => onChange({ ...node, percent: n })}
                  context={context}
                  depth={depth + 1}
                  path={[...path, node.type, 'percent']}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          )}

          {(node.type === 'round' || node.type === 'ceil' || node.type === 'floor') && (
            <div className="flex flex-col gap-2">
              <div>
                <Label className="mb-1 block">القيمة</Label>
                <FormulaTreeEditor
                  node={node.value}
                  onChange={(n) => onChange({ ...node, value: n })}
                  context={context}
                  depth={depth + 1}
                  path={[...path, node.type, 'value']}
                  onNavigate={onNavigate}
                />
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
                <FormulaTreeEditor
                  node={node.then}
                  onChange={(n) => onChange({ ...node, then: n })}
                  context={context}
                  depth={depth + 1}
                  path={[...path, node.type, 'then']}
                  onNavigate={onNavigate}
                />
              </div>
              <div>
                <Label className="mb-1 block">لو ما تحققش</Label>
                <FormulaTreeEditor
                  node={node.else}
                  onChange={(n) => onChange({ ...node, else: n })}
                  context={context}
                  depth={depth + 1}
                  path={[...path, node.type, 'else']}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          )}

          {node.type === 'date_diff' && (
            <div className="flex flex-col gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block">من</Label>
                  <SelectNative
                    value={dateSourceValue(node.from)}
                    onChange={(e) => onChange({ ...node, from: parseDateSourceValue(e.target.value) })}
                  >
                    {SYSTEM_DATE_SOURCES.map((source) => (
                      <option key={source.kind} value={source.kind}>
                        {source.label}
                      </option>
                    ))}
                    {context.fieldKeys.map((k) => (
                      <option key={k} value={`field:${k}`}>
                        حقل: {k}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label className="mb-1 block">إلى</Label>
                  <SelectNative
                    value={dateSourceValue(node.to)}
                    onChange={(e) => onChange({ ...node, to: parseDateSourceValue(e.target.value) })}
                  >
                    {SYSTEM_DATE_SOURCES.map((source) => (
                      <option key={source.kind} value={source.kind}>
                        {source.label}
                      </option>
                    ))}
                    {context.fieldKeys.map((k) => (
                      <option key={k} value={`field:${k}`}>
                        حقل: {k}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label className="mb-1 block">الوحدة</Label>
                  <SelectNative value={node.unit} onChange={(e) => onChange({ ...node, unit: e.target.value as DateDiffUnit })}>
                    {(Object.entries(DATE_DIFF_UNIT_LABELS) as [DateDiffUnit, string][]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label className="mb-1 block">التقريب</Label>
                  <SelectNative
                    value={node.rounding ?? 'exact'}
                    onChange={(e) => onChange({ ...node, rounding: e.target.value as DateDiffRounding })}
                  >
                    {(Object.entries(DATE_DIFF_ROUNDING_LABELS) as [DateDiffRounding, string][]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={node.inclusive ?? false}
                    onChange={(e) => onChange({ ...node, inclusive: e.target.checked })}
                  />
                  يحسب اليومين الطرفيين (من 1 لـ5 = 5 أيام)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={node.absolute ?? false}
                    onChange={(e) => onChange({ ...node, absolute: e.target.checked })}
                  />
                  دايمًا موجب
                </label>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                الأيام والأسابيع والشهور بتتحسب <strong>بالتقويم بتوقيت القاهرة</strong> — من 1 مارس لـ1 أبريل شهر
                واحد بالظبط، مش 31 ÷ 30.4. الدقايق والساعات بتتحسب كزمن منقضي فعلي.
              </p>
            </div>
          )}

          {node.type === 'distance' && (
            <div className="flex flex-col gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block">من</Label>
                  <SelectNative
                    value={geoSourceValue(node.from)}
                    onChange={(e) => onChange({ ...node, from: parseGeoSourceValue(e.target.value, node.from) })}
                  >
                    <option value="order_location">موقع الطلب</option>
                    <option value="point">نقطة ثابتة (مخزن/فرع)</option>
                    {context.fieldKeys.map((k) => (
                      <option key={k} value={`field:${k}`}>
                        حقل: {k}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <Label className="mb-1 block">إلى</Label>
                  <SelectNative
                    value={geoSourceValue(node.to)}
                    onChange={(e) => onChange({ ...node, to: parseGeoSourceValue(e.target.value, node.to) })}
                  >
                    <option value="order_location">موقع الطلب</option>
                    <option value="point">نقطة ثابتة (مخزن/فرع)</option>
                    {context.fieldKeys.map((k) => (
                      <option key={k} value={`field:${k}`}>
                        حقل: {k}
                      </option>
                    ))}
                  </SelectNative>
                </div>
              </div>
              {([['from', node.from] as const, ['to', node.to] as const])
                .filter(([, source]) => source.kind === 'point')
                .map(([side, source]) => (
                  <div key={side} className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="mb-1 block">{side === 'from' ? 'خط عرض (من)' : 'خط عرض (إلى)'}</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        dir="ltr"
                        value={(source as { lat: number }).lat}
                        onChange={(e) => onChange({ ...node, [side]: { kind: 'point', lat: Number(e.target.value), lng: (source as { lng: number }).lng } })}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block">{side === 'from' ? 'خط طول (من)' : 'خط طول (إلى)'}</Label>
                      <Input
                        type="number"
                        step="0.000001"
                        dir="ltr"
                        value={(source as { lng: number }).lng}
                        onChange={(e) => onChange({ ...node, [side]: { kind: 'point', lat: (source as { lat: number }).lat, lng: Number(e.target.value) } })}
                      />
                    </div>
                  </div>
                ))}
              <div>
                <Label className="mb-1 block">الوحدة</Label>
                <SelectNative value={node.unit} onChange={(e) => onChange({ ...node, unit: e.target.value as DistanceUnit })}>
                  {(Object.entries(DISTANCE_UNIT_LABELS) as [DistanceUnit, string][]).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
