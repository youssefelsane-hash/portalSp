'use client';

// محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — Admin Pricing Builder. كانت فجوة موثّقة صراحة:
// الباك-إند (حقول/قواعد/معاينة) كان جاهز ومختبر بالكامل من سيشن سابقة، بس مفيش أي واجهة أدمن
// بصرية تستخدمه — الطريقة الوحيدة كانت REST خام (curl) من سيشن اختبار. اتقفلت هنا.
//
// **قرار أمان متعمّد**: المعادلة (rule_type=formula) بتتحرر كـJSON بيمثّل نفس شجرة FormulaNode
// الآمنة اللي الباك-إند بيفهمها (pricing-formula.types.ts) — مفيش أي حقل نص حر بيتفسّر كجافاسكريبت
// أو SQL خالص. الباك-إند نفسه (`validateFormulaNode`) بيرفض أي عملية برّه القايمة البيضاء وقت
// الحفظ، فالواجهة دي مش مصدر الأمان الوحيد — بس بتعرض رسالة الرفض بوضوح للأدمن بدل ما تتبلع.

import { useEffect, useState, type FormEvent } from 'react';
import type {
  CreatePricingFieldBody,
  EvaluatePricingBody,
  PricingEvaluationResponseDto,
  PricingFieldOption,
  PricingFieldResponseDto,
  PricingFieldType,
  PricingRuleResponseDto,
  UpdatePricingFieldBody,
  UpsertPricingRuleBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

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

const FINAL_PRICE_TEMPLATE = JSON.stringify(
  {
    price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] },
  },
  null,
  2,
);

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
  const [formulaTextOverride, setFormulaTextOverride] = useState<string | null>(null);
  const formulaText =
    formulaTextOverride ?? (finalPriceRule ? JSON.stringify(finalPriceRule.payload, null, 2) : FINAL_PRICE_TEMPLATE);

  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<PricingEvaluationResponseDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  function loadAll() {
    authedFetch<PricingFieldResponseDto[]>(`/admin/services/${serviceId}/pricing-fields`)
      .then(setFields)
      .catch(() => setFields([]));
    authedFetch<PricingRuleResponseDto[]>(`/admin/services/${serviceId}/pricing-rules`)
      .then(setRules)
      .catch(() => setRules([]));
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
    setIsSaving(true);
    setError(null);
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
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(formulaText);
    } catch {
      setError('نص المعادلة (JSON) مش صالح — راجع الأقواس والفواصل');
      return;
    }
    const ok = await upsertRule({ rule_type: 'formula', rule_key: 'final_price', payload: parsed });
    if (ok) setFormulaTextOverride(null);
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

  async function handlePreview() {
    setIsPreviewing(true);
    setPreviewError(null);
    setPreviewResult(null);
    const fieldValues: Record<string, string | number | boolean> = {};
    for (const field of fields ?? []) {
      const raw = previewValues[field.field_key];
      if (raw === undefined || raw === '') continue;
      fieldValues[field.field_key] = field.field_type === 'checkbox' ? raw === 'true' : raw;
    }
    const body: EvaluatePricingBody = { field_values: fieldValues };
    try {
      const result = await authedFetch<PricingEvaluationResponseDto>(`/services/${serviceId}/evaluate-price`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsPreviewing(false);
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
            <p className="text-sm text-muted-foreground">مفيش حقول تسعير للخدمة دي لسه</p>
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
              <p className="text-sm text-muted-foreground">مفيش ثوابت متعرّفة لسه</p>
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
              <p className="text-sm text-muted-foreground">مفيش جداول بحث متعرّفة لسه</p>
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
          <p className="mb-2 text-sm text-muted-foreground">
            شجرة عمليات JSON آمنة بس — مفيش تنفيذ كود حر خالص. العمليات المسموحة: literal, field_ref, constant_ref, lookup_ref, add,
            subtract, multiply, divide, percentage, min, max, round, if. أي عملية تانية هترفض وقت الحفظ برسالة واضحة تحت.
          </p>
          <Textarea
            value={formulaText}
            onChange={(e) => setFormulaTextOverride(e.target.value)}
            rows={16}
            dir="ltr"
            className="font-mono text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={isSaving} onClick={handleSaveFormula}>
              حفظ المعادلة
            </Button>
            {finalPriceRule && (
              <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivateRule(finalPriceRule.id)}>
                تعطيل المعادلة الحالية
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* معاينة واختبار السعر */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">معاينة واختبار السعر</CardTitle>
        </CardHeader>
        <CardContent>
          {activeFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">أضف حقول أول عشان تقدر تعاين السعر</p>
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
              <Button size="sm" disabled={isPreviewing} onClick={handlePreview}>
                احسب السعر
              </Button>
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
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
