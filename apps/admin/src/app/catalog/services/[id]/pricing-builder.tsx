'use client';

// محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — Admin Pricing Builder. كانت فجوة موثّقة صراحة:
// الباك-إند (حقول/قواعد/معاينة) كان جاهز ومختبر بالكامل من سيشن سابقة، بس مفيش أي واجهة أدمن
// بصرية تستخدمه — الطريقة الوحيدة كانت REST خام (curl) من سيشن اختبار. اتقفلت هنا.
//
// **قرار أمان متعمّد**: المعادلة (rule_type=formula) بتتبني كـobject بيمثّل نفس شجرة FormulaNode
// الآمنة اللي الباك-إند بيفهمها (pricing-formula.types.ts) — مفيش أي حقل نص حر بيتفسّر كجافاسكريبت
// أو SQL خالص. الباك-إند نفسه (`validateFormulaNode`) بيرفض أي عملية برّه القايمة البيضاء وقت
// الحفظ، فالواجهة دي مش مصدر الأمان الوحيد — بس بتعرض رسالة الرفض بوضوح للأدمن بدل ما تتبلع.
//
// **مرحلة 3 (2026-08-13)**: المعادلة دلوقتي بتتبني بمحرر شجري بصري (`FormulaTreeEditor`، ملف
// formula-tree-editor.tsx) — كانت فجوة موثّقة صراحة ("لسه JSON AST في textarea، مش تجربة Super
// Admin احترافية"). وضع "عرض/تحرير JSON" لسه موجود اختياريًا (زرار toggle تحت)، مش الطريق
// الافتراضي. تفاصيل كاملة في apps/api/src/modules/pricing/README.md § مرحلة 3.

import { useEffect, useState, type FormEvent } from 'react';
import type {
  CreatePricingFieldBody,
  CreatePricingRuleTestBody,
  FinalPriceFormulaPayload,
  FormulaNode,
  LookupTableRulePayload,
  PricingEvaluationResponseDto,
  PricingFieldOption,
  PricingFieldResponseDto,
  PricingFieldType,
  PricingRuleResponseDto,
  PricingRuleTestResponseDto,
  PricingRuleTestRunResultDto,
  UpdatePricingFieldBody,
  UpsertPricingRuleBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { FormulaTreeEditor, type FormulaEditorContext } from './formula-tree-editor';
import { FORMULA_LIMITS } from '@baytak/shared-types';

const FIELD_TYPE_LABELS: Record<PricingFieldType, string> = {
  number: 'رقم',
  dropdown: 'قايمة منسدلة (اختيار واحد)',
  multi_select: 'قايمة منسدلة (اختيار متعدد)',
  checkbox: 'صح/خطأ',
  slider: 'شريط تمرير',
  area: 'مساحة',
  length: 'طول',
  volume: 'حجم',
  date: 'تاريخ',
  time: 'وقت',
  location: 'موقع (مش مدعوم في التطبيقات لسه)',
  image_upload: 'رفع صورة (مش مدعوم في التطبيقات لسه)',
  video_upload: 'رفع فيديو (مش مدعوم في التطبيقات لسه)',
  voice_note: 'ملاحظة صوتية (مش مدعومة في التطبيقات لسه)',
};

const FIELD_TYPES_WITH_OPTIONS: PricingFieldType[] = ['dropdown', 'multi_select'];
const FIELD_TYPES_WITH_RANGE: PricingFieldType[] = ['number', 'area', 'length', 'volume', 'slider'];

// أنواع حقول مش مدعومة في apps/customer-app لسه (راجع create_order_screen.dart's isSupported) —
// كانت فجوة موثّقة صراحة (مراجعة تقنية 2026-08-13): لو الأدمن يحطّها إجبارية، العميل بيوصل لحقل
// محتاج تفاصيل مش قادر يدخلها خالص، فمينفعش يكمّل الحجز أبدًا. الحل الأبسط للنسخة دي: نمنع
// الحفظ من الأساس بدل ما نستنى العميل يتفاجأ.
const UNSUPPORTED_FIELD_TYPES: PricingFieldType[] = ['location', 'image_upload', 'video_upload', 'voice_note'];

const DEFAULT_FORMULA_PAYLOAD: FinalPriceFormulaPayload = {
  price_cents: { type: 'literal', value: 0 },
};

// الحقول الاختيارية في FinalPriceFormulaPayload — كل واحد منهم قابل للإضافة/الحذف من الأدمن
// بزرار toggle (price_cents وحده إجباري دايمًا). القيمة الافتراضية عند التفعيل نفسها في كل مرة.
const OPTIONAL_PAYLOAD_KEYS: { key: keyof Omit<FinalPriceFormulaPayload, 'price_cents'>; labelAr: string }[] = [
  { key: 'min_price_cents', labelAr: 'أقل سعر مسموح' },
  { key: 'max_price_cents', labelAr: 'أعلى سعر مسموح' },
  { key: 'estimated_duration_days', labelAr: 'المدة المقدّرة (أيام)' },
  { key: 'required_technicians', labelAr: 'عدد الفنيين المطلوب' },
  { key: 'required_assistants', labelAr: 'عدد المساعدين المطلوب' },
  { key: 'requires_assistant', labelAr: 'محتاج مساعد؟ (0 = لأ، غير كده = أيوه)' },
  { key: 'suitable_for_emergency', labelAr: 'مناسب لطوارئ؟ (0 = لأ، غير كده = أيوه)' },
];

function emptyFieldForm(): CreatePricingFieldBody {
  return { field_key: '', label_ar: '', field_type: 'number', is_required: true };
}

export function PricingBuilder({ serviceId }: { serviceId: string }) {
  const { authedFetch } = useAuth();

  const [fields, setFields] = useState<PricingFieldResponseDto[] | null>(null);
  const [rules, setRules] = useState<PricingRuleResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [showNewField, setShowNewField] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState<CreatePricingFieldBody>(emptyFieldForm());
  const [fieldOptionsText, setFieldOptionsText] = useState(''); // "قيمة=تسمية" سطر لكل خيار

  const [lookupFieldKey, setLookupFieldKey] = useState('');
  const [lookupRuleKey, setLookupRuleKey] = useState('');
  const [lookupValuesText, setLookupValuesText] = useState(''); // "مفتاح=رقم" سطر لكل صف

  const [constantKey, setConstantKey] = useState('');
  const [constantValue, setConstantValue] = useState('');

  const finalPriceRule = rules?.find((r) => r.rule_type === 'formula' && r.rule_key === 'final_price' && r.is_active) ?? null;
  // null = العرض لسه مشتق من finalPriceRule (المصدر الحقيقي) — لحد ما الأدمن يبدأ يعدّل بنفسه.
  // نمط "derived state" بدل useEffect+setState (كان بيسبب cascading render فعلي، اتلقط بالـlint).
  // بقى object بنية (FinalPriceFormulaPayload) بدل نص JSON خام — المحرر البصري (FormulaTreeEditor)
  // بيعدّل عليه مباشرة، صفر JSON ظاهر للأدمن إلا لو فتح وضع "عرض JSON" الاختياري تحت.
  const [payloadOverride, setPayloadOverride] = useState<FinalPriceFormulaPayload | null>(null);
  const payload: FinalPriceFormulaPayload =
    payloadOverride ?? ((finalPriceRule?.payload as FinalPriceFormulaPayload | undefined) ?? DEFAULT_FORMULA_PAYLOAD);
  const setPayload = (next: FinalPriceFormulaPayload) => setPayloadOverride(next);

  const [showJsonView, setShowJsonView] = useState(false);
  const [jsonText, setJsonText] = useState<string | null>(null);

  // مؤشر التعقيد (docs/01B §4) — عمق/عقد الشجرة الحالية مقابل حدود FORMULA_LIMITS المشتركة
  const [breadcrumb, setBreadcrumb] = useState<string[] | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // سياق المحرر البصري — أسماء الحقول/الثوابت/جداول البحث المتاحة، عشان FormulaTreeEditor يعرضها
  // كـdropdowns بدل ما الأدمن يكتب field_key بإيده (زي ما كان لازم في وضع JSON القديم).
  function maxDepthOf(node: FormulaNode | undefined): number {
    if (!node || typeof node !== 'object') return 0;
    const kids: FormulaNode[] = [];
    if ('operands' in node && Array.isArray((node as { operands?: FormulaNode[] }).operands)) {
      kids.push(...(node as unknown as { operands: FormulaNode[] }).operands);
    }
    if ('base' in node) kids.push((node as unknown as { base: FormulaNode }).base);
    if ('percent' in node) kids.push((node as unknown as { percent: FormulaNode }).percent);
    if ('value' in node && (node.type === 'round' || node.type === 'ceil' || node.type === 'floor')) {
      kids.push((node as unknown as { value: FormulaNode }).value);
    }
    if (node.type === 'if') {
      kids.push((node as unknown as { then: FormulaNode; else: FormulaNode }).then);
      kids.push((node as unknown as { then: FormulaNode; else: FormulaNode }).else);
    }
    return 1 + Math.max(0, ...kids.map(maxDepthOf));
  }

  function countNodes(node: FormulaNode | undefined): number {
    if (!node || typeof node !== 'object') return 0;
    let total = 1;
    if ('operands' in node && Array.isArray((node as { operands?: FormulaNode[] }).operands)) {
      for (const o of (node as unknown as { operands: FormulaNode[] }).operands) total += countNodes(o);
    }
    if ('base' in node) total += countNodes((node as unknown as { base: FormulaNode }).base);
    if ('percent' in node) total += countNodes((node as unknown as { percent: FormulaNode }).percent);
    if ('value' in node && (node.type === 'round' || node.type === 'ceil' || node.type === 'floor')) {
      total += countNodes((node as unknown as { value: FormulaNode }).value);
    }
    if (node.type === 'if') {
      total += countNodes((node as unknown as { then: FormulaNode; else: FormulaNode }).then);
      total += countNodes((node as unknown as { then: FormulaNode; else: FormulaNode }).else);
    }
    return total;
  }

  const formulaContext: FormulaEditorContext = {
    fieldKeys: (fields ?? []).filter((f) => f.is_active).map((f) => f.field_key),
    constantKeys: (rules ?? []).filter((r) => r.rule_type === 'constant' && r.is_active).map((r) => r.rule_key),
    lookupTables: (rules ?? [])
      .filter((r) => r.rule_type === 'lookup_table' && r.is_active)
      .map((r) => ({ ruleKey: r.rule_key, fieldKey: (r.payload as LookupTableRulePayload).field_key })),
  };

  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<
    (PricingEvaluationResponseDto & { trace?: { path: string; expression: string; value: number }[]; explanation?: string[] }) | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // حالات اختبار محفوظة (Script 4 Part L §48) — "المدخلات دي لازم تنتج السعر ده بالظبط"، بتتشغّل
  // ضد المسوّدة الحالية (payload) عشان تتأكد إن تعديلك ما كسرش سيناريو معروف قبل ما تحفظ.
  const [ruleTests, setRuleTests] = useState<PricingRuleTestResponseDto[] | null>(null);
  const [showNewRuleTest, setShowNewRuleTest] = useState(false);
  const [ruleTestLabel, setRuleTestLabel] = useState('');
  const [ruleTestFieldValues, setRuleTestFieldValues] = useState<Record<string, string>>({});
  const [ruleTestExpectedEgp, setRuleTestExpectedEgp] = useState('');
  const [ruleTestRunResults, setRuleTestRunResults] = useState<PricingRuleTestRunResultDto[] | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);

  function loadAll() {
    authedFetch<PricingFieldResponseDto[]>(`/admin/services/${serviceId}/pricing-fields`)
      .then(setFields)
      .catch(() => setFields([]));
    authedFetch<PricingRuleResponseDto[]>(`/admin/services/${serviceId}/pricing-rules`)
      .then(setRules)
      .catch(() => setRules([]));
    authedFetch<PricingRuleTestResponseDto[]>(`/admin/services/${serviceId}/pricing-tests`)
      .then(setRuleTests)
      .catch(() => setRuleTests([]));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  function startEditField(field: PricingFieldResponseDto) {
    setEditingFieldId(field.id);
    setShowNewField(true);
    setFieldForm({
      field_key: field.field_key,
      label_ar: field.label_ar,
      field_type: field.field_type,
      is_required: field.is_required,
      display_order: field.display_order,
      unit_ar: field.unit_ar ?? undefined,
      min_value: field.min_value ?? undefined,
      max_value: field.max_value ?? undefined,
    });
    setFieldOptionsText((field.options ?? []).map((o) => `${o.value}=${o.label_ar}`).join('\n'));
  }

  function resetFieldForm() {
    setEditingFieldId(null);
    setFieldForm(emptyFieldForm());
    setFieldOptionsText('');
    setShowNewField(false);
  }

  function startNewField() {
    setShowNewField(true);
    setEditingFieldId(null);
    setFieldForm(emptyFieldForm());
    setFieldOptionsText('');
  }

  function toggleFieldFormVisibility() {
    if (showNewField) {
      resetFieldForm();
    } else {
      startNewField();
    }
  }

  function parseOptionsText(text: string): PricingFieldOption[] | undefined {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return undefined;
    return lines.map((line) => {
      const idx = line.indexOf('=');
      const value = idx === -1 ? line : line.slice(0, idx).trim();
      const labelAr = idx === -1 ? line : line.slice(idx + 1).trim();
      return { value, label_ar: labelAr };
    });
  }

  async function handleSaveField(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (UNSUPPORTED_FIELD_TYPES.includes(fieldForm.field_type) && fieldForm.is_required) {
      setError(
        `نوع الحقل "${FIELD_TYPE_LABELS[fieldForm.field_type]}" مش مدعوم في تطبيقات العميل/الفني لسه — مينفعش يبقى إجباري (العميل مش هيقدر يكمّل الحجز خالص). سيبه اختياري، أو استخدم نوع حقل مدعوم.`,
      );
      return;
    }
    setIsSaving(true);
    const hasOptions = FIELD_TYPES_WITH_OPTIONS.includes(fieldForm.field_type);
    const body: CreatePricingFieldBody | UpdatePricingFieldBody = {
      ...fieldForm,
      options: hasOptions ? parseOptionsText(fieldOptionsText) : undefined,
    };
    try {
      if (editingFieldId) {
        await authedFetch(`/admin/services/pricing-fields/${editingFieldId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await authedFetch(`/admin/services/${serviceId}/pricing-fields`, { method: 'POST', body: JSON.stringify(body) });
      }
      resetFieldForm();
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleFieldActive(field: PricingFieldResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/pricing-fields/${field.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !field.is_active }),
      });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteField(fieldId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/pricing-fields/${fieldId}`, { method: 'DELETE' });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function upsertRule(body: UpsertPricingRuleBody) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${serviceId}/pricing-rules`, { method: 'PUT', body: JSON.stringify(body) });
      loadAll();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveConstant(e: FormEvent) {
    e.preventDefault();
    const value = Number(constantValue);
    if (!constantKey.trim() || Number.isNaN(value)) {
      setError('اسم الثابت وقيمته لازم يتملوا صح');
      return;
    }
    const ok = await upsertRule({ rule_type: 'constant', rule_key: constantKey.trim(), payload: { value } });
    if (ok) {
      setConstantKey('');
      setConstantValue('');
    }
  }

  async function handleSaveLookupTable(e: FormEvent) {
    e.preventDefault();
    if (!lookupRuleKey.trim() || !lookupFieldKey) {
      setError('اسم الجدول والحقل المرتبط بيه لازم يتحددوا');
      return;
    }
    const values: Record<string, number> = {};
    for (const line of lookupValuesText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) {
        setError(`صف "${trimmed}" لازم يكون بصيغة مفتاح=رقم`);
        return;
      }
      const key = trimmed.slice(0, idx).trim();
      const num = Number(trimmed.slice(idx + 1).trim());
      if (Number.isNaN(num)) {
        setError(`القيمة بتاعة "${key}" لازم تكون رقم`);
        return;
      }
      values[key] = num;
    }
    const ok = await upsertRule({
      rule_type: 'lookup_table',
      rule_key: lookupRuleKey.trim(),
      payload: { field_key: lookupFieldKey, values },
    });
    if (ok) {
      setLookupRuleKey('');
      setLookupFieldKey('');
      setLookupValuesText('');
    }
  }

  async function handleSaveFormula() {
    // وضع عرض JSON مفعّل — لازم نزامن أي تعديل يدوي فيه لـpayload قبل الحفظ (نفس فحص الأخطاء
    // القديم، بس دلوقتي اختياري مش الطريق الوحيد).
    let toSave = payload;
    if (showJsonView && jsonText !== null) {
      try {
        toSave = JSON.parse(jsonText);
      } catch {
        setJsonError('نص المعادلة (JSON) مش صالح — راجع الأقواس والفواصل');
        return;
      }
      setJsonError(null);
    }
    const ok = await upsertRule({ rule_type: 'formula', rule_key: 'final_price', payload: toSave as unknown as Record<string, unknown> });
    if (ok) {
      setPayloadOverride(null);
      setJsonText(null);
    }
  }

  async function handleDeactivateRule(ruleId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/pricing-rules/${ruleId}`, { method: 'DELETE' });
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // معاينة مسوّدة (Script 4 Part L §47-48) — كانت فجوة موثّقة صراحة: المعاينة كانت بتنادي
  // evaluate-price اللي بيقرا القاعدة المحفوظة فعليًا بس، يعني الأدمن لازم يحفظ (ينشر لعملاء
  // حقيقيين) التعديل الأول قبل ما يقدر يشوف نتيجته. دلوقتي بتبعت payload الحالي (اللي لسه بيتعدّل
  // في المحرر، ممكن يكون متغيّر ولسه مش محفوظ) لـ evaluate-draft — بدون أي كتابة في الداتابيز.
  function collectPreviewFieldValues(): Record<string, string | number | boolean> {
    const fieldValues: Record<string, string | number | boolean> = {};
    for (const field of fields ?? []) {
      const raw = previewValues[field.field_key];
      // بَقّة حقيقية اتلقطت (مراجعة مالك مباشرة): حقل checkbox من غير اختيار صريح ("—" الافتراضي
      // في الـ<select>) كان بيتجاهل تمامًا زي أي حقل تاني فاضي — لو الحقل مطلوب، المعادلة كانت
      // بترفض "الحقل مطلوب" لحد ما الأدمن يختار "صح" صراحة مرة (حتى لو رجع اختار "خطأ" بعد كده
      // بيشتغل عادي). نفس الافتراض الضمني اللي الباك-إند نفسه بيطبّقه لحقول checkbox من غير
      // default_value (resolveDefaultValue في pricing-engine.service.ts): false، مش تجاهل.
      if (field.field_type === 'checkbox') {
        fieldValues[field.field_key] = raw === 'true';
        continue;
      }
      if (raw === undefined || raw === '') continue;
      fieldValues[field.field_key] = raw;
    }
    return fieldValues;
  }

  async function handlePreview() {
    setIsPreviewing(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const result = await authedFetch<PricingEvaluationResponseDto>(`/admin/services/${serviceId}/pricing/evaluate-draft`, {
        method: 'POST',
        body: JSON.stringify({ field_values: collectPreviewFieldValues(), formula_payload: payload }),
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsPreviewing(false);
    }
  }

  // حالات اختبار محفوظة (Script 4 Part L §48) — بتاخد مدخلات المعاينة الحالية (previewValues)
  // كنقطة بداية سريعة، الأدمن يعدّل الـlabel/السعر المتوقع بس.
  function openNewRuleTestForm() {
    setRuleTestFieldValues({ ...previewValues });
    setRuleTestExpectedEgp(previewResult ? (previewResult.price_cents / 100).toFixed(2) : '');
    setRuleTestLabel('');
    setShowNewRuleTest(true);
  }

  async function handleCreateRuleTest(e: FormEvent) {
    e.preventDefault();
    if (!ruleTestLabel.trim() || ruleTestExpectedEgp.trim() === '') return;
    const fieldValues: Record<string, string | number | boolean> = {};
    for (const field of fields ?? []) {
      const raw = ruleTestFieldValues[field.field_key];
      // نفس إصلاح collectPreviewFieldValues فوق — حقل checkbox من غير اختيار صريح لازم يتفسّر
      // false مش يتجاهل تمامًا.
      if (field.field_type === 'checkbox') {
        fieldValues[field.field_key] = raw === 'true';
        continue;
      }
      if (raw === undefined || raw === '') continue;
      fieldValues[field.field_key] = raw;
    }
    setIsSaving(true);
    setError(null);
    try {
      const body: CreatePricingRuleTestBody = {
        label: ruleTestLabel.trim(),
        field_values: fieldValues,
        expected_price_cents: Math.round(Number(ruleTestExpectedEgp) * 100),
      };
      await authedFetch(`/admin/services/${serviceId}/pricing-tests`, { method: 'POST', body: JSON.stringify(body) });
      setShowNewRuleTest(false);
      setRuleTestRunResults(null);
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRuleTest(testId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/pricing-tests/${testId}`, { method: 'DELETE' });
      setRuleTestRunResults(null);
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // بيشغّل كل الحالات ضد المسوّدة الحالية (payload) — مش القاعدة المحفوظة، عشان الأدمن يتأكد
  // إن تعديله اللي لسه بيعمله ما كسرش أي سيناريو معروف قبل ما يحفظ.
  async function handleRunRuleTests() {
    setIsRunningTests(true);
    setError(null);
    try {
      const results = await authedFetch<PricingRuleTestRunResultDto[]>(`/admin/services/${serviceId}/pricing-tests/run`, {
        method: 'POST',
        body: JSON.stringify({ formula_payload: payload }),
      });
      setRuleTestRunResults(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsRunningTests(false);
    }
  }

  const constants = rules?.filter((r) => r.rule_type === 'constant' && r.is_active) ?? [];
  const lookupTables = rules?.filter((r) => r.rule_type === 'lookup_table' && r.is_active) ?? [];
  const activeFields = (fields ?? []).filter((f) => f.is_active).sort((a, b) => a.display_order - b.display_order);
  const dropdownFields = (fields ?? []).filter((f) => FIELD_TYPES_WITH_OPTIONS.includes(f.field_type));

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-destructive">{error}</p>}

      {/* حقول الفورم الديناميكي */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">حقول الفورم الديناميكي</CardTitle>
          <Button size="sm" variant="outline" onClick={toggleFieldFormVisibility}>
            {showNewField ? 'إلغاء' : '+ حقل جديد'}
          </Button>
        </CardHeader>
        <CardContent>
          {showNewField && (
            <form onSubmit={handleSaveField} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_key">اسم الحقل البرمجي (إنجليزي)</Label>
                  <Input
                    id="pf_key"
                    value={fieldForm.field_key}
                    onChange={(e) => setFieldForm((f) => ({ ...f, field_key: e.target.value }))}
                    placeholder="مثال: area"
                    required
                    disabled={!!editingFieldId}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_label">التسمية بالعربي</Label>
                  <Input
                    id="pf_label"
                    value={fieldForm.label_ar}
                    onChange={(e) => setFieldForm((f) => ({ ...f, label_ar: e.target.value }))}
                    placeholder="مثال: المساحة"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_type">نوع الحقل</Label>
                  <SelectNative
                    id="pf_type"
                    value={fieldForm.field_type}
                    onChange={(e) => setFieldForm((f) => ({ ...f, field_type: e.target.value as PricingFieldType }))}
                  >
                    {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_unit">الوحدة (اختياري)</Label>
                  <Input
                    id="pf_unit"
                    value={fieldForm.unit_ar ?? ''}
                    onChange={(e) => setFieldForm((f) => ({ ...f, unit_ar: e.target.value || undefined }))}
                    placeholder="مثال: م²"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_order">ترتيب العرض</Label>
                  <Input
                    id="pf_order"
                    type="number"
                    value={fieldForm.display_order ?? ''}
                    onChange={(e) => setFieldForm((f) => ({ ...f, display_order: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                {FIELD_TYPES_WITH_RANGE.includes(fieldForm.field_type) && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pf_min">أقل قيمة (اختياري)</Label>
                      <Input
                        id="pf_min"
                        type="number"
                        step="0.01"
                        value={fieldForm.min_value ?? ''}
                        onChange={(e) => setFieldForm((f) => ({ ...f, min_value: e.target.value ? Number(e.target.value) : undefined }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="pf_max">أعلى قيمة (اختياري)</Label>
                      <Input
                        id="pf_max"
                        type="number"
                        step="0.01"
                        value={fieldForm.max_value ?? ''}
                        onChange={(e) => setFieldForm((f) => ({ ...f, max_value: e.target.value ? Number(e.target.value) : undefined }))}
                      />
                    </div>
                  </>
                )}
                <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
                  <input
                    type="checkbox"
                    checked={fieldForm.is_required ?? false}
                    onChange={(e) => setFieldForm((f) => ({ ...f, is_required: e.target.checked }))}
                  />
                  حقل إجباري
                </label>
              </div>
              {FIELD_TYPES_WITH_OPTIONS.includes(fieldForm.field_type) && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pf_options">الخيارات — سطر لكل خيار بصيغة (قيمة=تسمية بالعربي)</Label>
                  <Textarea
                    id="pf_options"
                    rows={4}
                    value={fieldOptionsText}
                    onChange={(e) => setFieldOptionsText(e.target.value)}
                    placeholder={'internal=داخلي\nexternal=خارجي'}
                    dir="ltr"
                  />
                </div>
              )}
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                {editingFieldId ? 'حفظ التعديل' : 'إضافة الحقل'}
              </Button>
            </form>
          )}
          {!fields ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : fields.length === 0 ? (
            <EmptyState title="مفيش حقول تسعير للخدمة دي لسه" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الحقل</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>إجباري؟</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields
                  .slice()
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((field) => (
                    <TableRow key={field.id}>
                      <TableCell>
                        {field.label_ar} <span className="text-muted-foreground" dir="ltr">({field.field_key})</span>
                      </TableCell>
                      <TableCell>{FIELD_TYPE_LABELS[field.field_type]}</TableCell>
                      <TableCell>{field.is_required ? 'إجباري' : 'اختياري'}</TableCell>
                      <TableCell dir="ltr">{field.display_order}</TableCell>
                      <TableCell>
                        <button type="button" disabled={isSaving} onClick={() => toggleFieldActive(field)} className="cursor-pointer">
                          <Badge variant={field.is_active ? 'secondary' : 'outline'}>{field.is_active ? 'نشط' : 'معطّل'}</Badge>
                        </button>
                      </TableCell>
                      <TableCell className="flex gap-2">
                        <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => startEditField(field)}>
                          تعديل
                        </Button>
                        <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeleteField(field.id)}>
                          حذف
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* الثوابت */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ثوابت التسعير</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveConstant} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="const_key">اسم الثابت (يُستخدم داخل المعادلة كـ constant_ref)</Label>
              <Input id="const_key" value={constantKey} onChange={(e) => setConstantKey(e.target.value)} placeholder="مثال: floor_surcharge" dir="ltr" required />
              <Label htmlFor="const_value">القيمة (بالقرش لو سعر)</Label>
              <Input id="const_value" type="number" step="0.01" value={constantValue} onChange={(e) => setConstantValue(e.target.value)} required />
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                حفظ الثابت
              </Button>
            </form>
            {constants.length === 0 ? (
              <EmptyState title="مفيش ثوابت متعرّفة لسه" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>القيمة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {constants.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell dir="ltr">{rule.rule_key}</TableCell>
                      <TableCell dir="ltr">{(rule.payload as { value: number }).value}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivateRule(rule.id)}>
                          تعطيل
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* جداول البحث */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">جداول البحث (Lookup Tables)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveLookupTable} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="lookup_key">اسم الجدول (يُستخدم داخل المعادلة كـ lookup_ref)</Label>
              <Input id="lookup_key" value={lookupRuleKey} onChange={(e) => setLookupRuleKey(e.target.value)} placeholder="مثال: price_per_meter" dir="ltr" required />
              <Label htmlFor="lookup_field">الحقل المرتبط (لازم يكون قايمة منسدلة)</Label>
              <SelectNative id="lookup_field" value={lookupFieldKey} onChange={(e) => setLookupFieldKey(e.target.value)} required>
                <option value="" disabled>
                  اختار حقل
                </option>
                {dropdownFields.map((f) => (
                  <option key={f.id} value={f.field_key}>
                    {f.label_ar} ({f.field_key})
                  </option>
                ))}
              </SelectNative>
              <Label htmlFor="lookup_values">القيم — سطر لكل صف بصيغة (مفتاح=رقم)</Label>
              <Textarea
                id="lookup_values"
                rows={4}
                value={lookupValuesText}
                onChange={(e) => setLookupValuesText(e.target.value)}
                placeholder={'internal=140\nexternal=165'}
                dir="ltr"
              />
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                حفظ جدول البحث
              </Button>
            </form>
            {lookupTables.length === 0 ? (
              <EmptyState title="مفيش جداول بحث متعرّفة لسه" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الحقل</TableHead>
                    <TableHead>القيم</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookupTables.map((rule) => {
                    const payload = rule.payload as { field_key: string; values: Record<string, number> };
                    return (
                      <TableRow key={rule.id}>
                        <TableCell dir="ltr">{rule.rule_key}</TableCell>
                        <TableCell dir="ltr">{payload.field_key}</TableCell>
                        <TableCell dir="ltr">{Object.entries(payload.values).map(([k, v]) => `${k}=${v}`).join(', ')}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivateRule(rule.id)}>
                            تعطيل
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* المعادلة النهائية */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">المعادلة النهائية (final_price)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            ابني معادلة السعر بصريًا من غير ما تكتب أي JSON — اختار نوع كل عنصر من القايمة، والباك-إند
            بيرفض بوضوح لو الشجرة اتخربطت (نفس الأمان القديم بالحرف، بس مش محتاج تكتب الشكل بنفسك).
          </p>

          <div className="mb-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Label className="block font-medium">السعر النهائي (price_cents) — إجباري</Label>
              {(() => {
                const depth = maxDepthOf(payload?.price_cents);
                const nodes = countNodes(payload?.price_cents);
                const depthTone = depth >= FORMULA_LIMITS.MAX_DEPTH ? 'bg-destructive text-white' : depth >= FORMULA_LIMITS.MAX_DEPTH * 0.85 ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground';
                const nodesTone = nodes > FORMULA_LIMITS.MAX_NODE_COUNT ? 'bg-destructive text-white' : nodes >= FORMULA_LIMITS.MAX_NODE_COUNT * 0.9 ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground';
                return (
                  <>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${depthTone}`} title="أقصى عمق في الشجرة مقابل الحد">
                      العمق: {depth}/{FORMULA_LIMITS.MAX_DEPTH}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${nodesTone}`} title="عدد العقد مقابل الحد">
                      العقد: {nodes}/{FORMULA_LIMITS.MAX_NODE_COUNT}
                    </span>
                  </>
                );
              })()}
            </div>
            {breadcrumb && (
              <p dir="ltr" className="mb-2 truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground" title={breadcrumb.join(' → ')}>
                {breadcrumb.join(' → ')}
              </p>
            )}
            <FormulaTreeEditor
              node={payload.price_cents}
              onChange={(n) => setPayload({ ...payload, price_cents: n })}
              context={formulaContext}
              path={['price_cents']}
              onNavigate={setBreadcrumb}
            />
          </div>

          {OPTIONAL_PAYLOAD_KEYS.map(({ key, labelAr }) => {
            const current = payload[key];
            return (
              <div key={key} className="mb-4 border-t pt-3">
                <label className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={current !== undefined}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPayload({ ...payload, [key]: { type: 'literal', value: 0 } as FormulaNode });
                      } else {
                        const next = { ...payload };
                        delete next[key];
                        setPayload(next);
                      }
                    }}
                  />
                  {labelAr}
                </label>
                {current !== undefined && (
                  <FormulaTreeEditor
                    node={current}
                    onChange={(n) => setPayload({ ...payload, [key]: n })}
                    context={formulaContext}
                    path={[key]}
                    onNavigate={setBreadcrumb}
                  />
                )}
              </div>
            );
          })}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={isSaving} onClick={handleSaveFormula}>
              حفظ المعادلة
            </Button>
            {finalPriceRule && (
              <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivateRule(finalPriceRule.id)}>
                تعطيل المعادلة الحالية
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!showJsonView) setJsonText(JSON.stringify(payload, null, 2));
                setShowJsonView((s) => !s);
              }}
            >
              {showJsonView ? 'إخفاء JSON' : 'عرض/تحرير JSON (متقدّم)'}
            </Button>
          </div>

          {/* وضع متقدّم اختياري — عرض/تعديل نفس الـpayload كـJSON خام (نسخ/لصق سريع، مراجعة الشكل
              المخزَّن فعليًا) بدل ما يبقى الطريق الوحيد زي قبل كده. "طبّق" بيرجّع القيمة للمحرر
              البصري فوق، مفيش مصدرين حقيقة منفصلين. */}
          {showJsonView && (
            <div className="mt-3 rounded-md border p-3">
              <Textarea
                value={jsonText ?? JSON.stringify(payload, null, 2)}
                onChange={(e) => setJsonText(e.target.value)}
                rows={14}
                dir="ltr"
                className="font-mono text-sm"
              />
              {jsonError && <p className="mt-1 text-sm text-destructive">{jsonError}</p>}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonText ?? '{}');
                    setPayload(parsed);
                    setJsonError(null);
                  } catch {
                    setJsonError('نص JSON مش صالح — راجع الأقواس والفواصل');
                  }
                }}
              >
                طبّق التعديل على المحرر البصري
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* معاينة واختبار السعر */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">معاينة واختبار السعر</CardTitle>
        </CardHeader>
        <CardContent>
          {activeFields.length === 0 ? (
            <EmptyState title="أضف حقول أول عشان تقدر تعاين السعر" />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {activeFields.map((field) => (
                  <div key={field.id} className="flex flex-col gap-1">
                    <Label htmlFor={`preview_${field.field_key}`}>
                      {field.label_ar}
                      {field.unit_ar ? ` (${field.unit_ar})` : ''}
                    </Label>
                    {FIELD_TYPES_WITH_OPTIONS.includes(field.field_type) ? (
                      <SelectNative
                        id={`preview_${field.field_key}`}
                        value={previewValues[field.field_key] ?? ''}
                        onChange={(e) => setPreviewValues((v) => ({ ...v, [field.field_key]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label_ar}
                          </option>
                        ))}
                      </SelectNative>
                    ) : field.field_type === 'checkbox' ? (
                      <SelectNative
                        id={`preview_${field.field_key}`}
                        value={previewValues[field.field_key] ?? ''}
                        onChange={(e) => setPreviewValues((v) => ({ ...v, [field.field_key]: e.target.value }))}
                      >
                        <option value="">—</option>
                        <option value="true">صح</option>
                        <option value="false">خطأ</option>
                      </SelectNative>
                    ) : (
                      <Input
                        id={`preview_${field.field_key}`}
                        type={FIELD_TYPES_WITH_RANGE.includes(field.field_type) ? 'number' : 'text'}
                        step="0.01"
                        value={previewValues[field.field_key] ?? ''}
                        onChange={(e) => setPreviewValues((v) => ({ ...v, [field.field_key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={isPreviewing} onClick={handlePreview}>
                  احسب السعر
                </Button>
                <Button size="sm" variant="outline" onClick={openNewRuleTestForm}>
                  احفظ كحالة اختبار
                </Button>
              </div>
              {previewError && <p className="mt-3 text-destructive">{previewError}</p>}
              {previewResult && (
                <div className="mt-3 rounded-md border p-3 text-sm">
                  <p className="text-lg font-semibold">{formatEgp(previewResult.price_cents)}</p>
                  {(previewResult.min_price_cents !== null || previewResult.max_price_cents !== null) && (
                    <p className="text-muted-foreground">
                      المدى: {previewResult.min_price_cents !== null ? formatEgp(previewResult.min_price_cents) : '—'} —{' '}
                      {previewResult.max_price_cents !== null ? formatEgp(previewResult.max_price_cents) : '—'}
                    </p>
                  )}
                  {previewResult.estimated_duration_days !== null && (
                    <p className="text-muted-foreground">المدة المتوقعة: {previewResult.estimated_duration_days} يوم</p>
                  )}
                  {previewResult.required_technicians !== null && (
                    <p className="text-muted-foreground">
                      الطاقم المطلوب: {previewResult.required_technicians} فني
                      {previewResult.required_assistants ? ` + ${previewResult.required_assistants} مساعد` : ''}
                    </p>
                  )}

                  {/* خطوات الحساب (docs/01B §5) — نفس أرقام الإنتاج، عرض للأدمن بس */}
                  {previewResult.trace && previewResult.trace.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">خطوات الحساب</summary>
                      <ul dir="ltr" className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                        {previewResult.trace.map((step, i) => (
                          <li key={i}>
                            {step.expression} <span className="opacity-60">[{step.path}]</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* الشرح الهيكلي (§6) — شرح فقط، مصدر التسعير هو المعادلة نفسها */}
                  {previewResult.explanation && previewResult.explanation.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">شرح المعادلة</summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {previewResult.explanation.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* حالات اختبار محفوظة (Script 4 Part L §48) — "المدخلات دي لازم تنتج السعر ده بالظبط"،
          بتتشغّل ضد المسوّدة الحالية (payload) مش القاعدة المحفوظة — تتأكد إن التعديل اللي لسه
          بتعمله ما كسرش سيناريو معروف قبل ما تحفظ. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">حالات اختبار محفوظة ({ruleTests?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!ruleTests || ruleTests.length === 0 ? (
            <EmptyState title="مفيش حالات اختبار محفوظة — احسب سعر فوق واحفظه كحالة اختبار" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوصف</TableHead>
                  <TableHead>المدخلات</TableHead>
                  <TableHead>السعر المتوقع</TableHead>
                  <TableHead>النتيجة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ruleTests.map((test) => {
                  const runResult = ruleTestRunResults?.find((r) => r.id === test.id) ?? null;
                  return (
                    <TableRow key={test.id}>
                      <TableCell>{test.label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(test.field_values)
                          .map(([k, v]) => `${k}=${v}`)
                          .join('، ')}
                      </TableCell>
                      <TableCell>{formatEgp(test.expected_price_cents)}</TableCell>
                      <TableCell>
                        {!runResult ? (
                          <span className="text-muted-foreground">—</span>
                        ) : runResult.error ? (
                          <Badge variant="destructive">خطأ: {runResult.error}</Badge>
                        ) : runResult.passed ? (
                          <Badge variant="secondary">ناجح ({formatEgp(runResult.actual_price_cents ?? 0)})</Badge>
                        ) : (
                          <Badge variant="destructive">فشل ({formatEgp(runResult.actual_price_cents ?? 0)})</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" disabled={isSaving} onClick={() => handleDeleteRuleTest(test.id)}>
                          حذف
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {ruleTests && ruleTests.length > 0 && (
            <Button className="mt-3" size="sm" disabled={isRunningTests} onClick={handleRunRuleTests}>
              {isRunningTests ? 'جاري التشغيل…' : 'شغّل كل الحالات ضد المسوّدة الحالية'}
            </Button>
          )}
          {showNewRuleTest && (
            <form onSubmit={handleCreateRuleTest} className="mt-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="rule_test_label">الوصف</Label>
              <Input id="rule_test_label" value={ruleTestLabel} onChange={(e) => setRuleTestLabel(e.target.value)} required />
              <Label htmlFor="rule_test_expected">السعر المتوقع (جنيه)</Label>
              <Input
                id="rule_test_expected"
                type="number"
                min={0}
                step="0.01"
                value={ruleTestExpectedEgp}
                onChange={(e) => setRuleTestExpectedEgp(e.target.value)}
                required
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isSaving}>
                  حفظ حالة الاختبار
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowNewRuleTest(false)}>
                  إلغاء
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
