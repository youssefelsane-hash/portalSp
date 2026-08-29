'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
  AddressResponseDto,
  AdminCustomerResponseDto,
  AdminServiceCategoryResponseDto,
  AdminServiceResponseDto,
  CreateOrderForCustomerResponseDto,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PricingFieldOption {
  value: string;
  label_ar: string;
}

interface PricingField {
  id: string;
  field_key: string;
  label_ar: string;
  field_type:
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
  is_required: boolean;
  display_order: number;
  unit_ar: string | null;
  options: PricingFieldOption[] | null;
  min_value: number | null;
  max_value: number | null;
  default_value: string | null;
  is_active: boolean;
}

function initialFieldValue(field: PricingField): unknown {
  if (field.field_type === 'checkbox') return field.default_value === 'true';
  if (field.field_type === 'multi_select') {
    if (!field.default_value) return [];
    try {
      const parsed = JSON.parse(field.default_value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  if (['number', 'slider', 'area', 'length', 'volume'].includes(field.field_type)) {
    return field.default_value === null || field.default_value === '' ? '' : Number(field.default_value);
  }
  return field.default_value ?? '';
}

// Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). كانت فجوة موثّقة صراحة: order_source_channel
// عنده قيمة 'call_center' من زمان بس orders.service.ts كان بيحط CUSTOMER_APP دايمًا — مفيش مسار
// حقيقي أصلاً. الصفحة دي بتستخدم نفس محرك التسعير/الجدولة الحقيقي (POST /admin/orders/for-customer
// → OrdersService.create() بالحرف)، الطلب بيتملك للعميل نفسه دايمًا مش للموظف. صلاحية مخصصة
// (orders.create_for_customer) مش ممنوحة لكل أدمن — migration 0131.
export default function CreateOrderForCustomerPage() {
  const { authedFetch, hasPermission } = useAuth();

  const [phoneQuery, setPhoneQuery] = useState('');
  const [customers, setCustomers] = useState<AdminCustomerResponseDto[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<AdminCustomerResponseDto | null>(null);
  const [addresses, setAddresses] = useState<AddressResponseDto[] | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState('');

  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [services, setServices] = useState<AdminServiceResponseDto[] | null>(null);
  const [selectedService, setSelectedService] = useState<AdminServiceResponseDto | null>(null);

  const [problemDescription, setProblemDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [pricingFields, setPricingFields] = useState<PricingField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<CreateOrderForCustomerResponseDto | null>(null);

  const canCreate = hasPermission('orders.create_for_customer');

  async function searchCustomers(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ per_page: '10' });
      if (phoneQuery.trim()) params.set('phone_number', phoneQuery.trim());
      const result = await authedFetch<AdminCustomerResponseDto[]>(`/admin/customers?${params.toString()}`);
      setCustomers(result);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'حصل خطأ في البحث');
    } finally {
      setSearching(false);
    }
  }

  async function selectCustomer(customer: AdminCustomerResponseDto) {
    setSelectedCustomer(customer);
    setAddresses(null);
    setSelectedAddressId('');
    try {
      const result = await authedFetch<AddressResponseDto[]>(`/admin/customers/${customer.user_id}/addresses`);
      setAddresses(result);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل عناوين العميل');
    }
    if (categories === null) {
      authedFetch<AdminServiceCategoryResponseDto[]>('/admin/service-categories')
        .then((cats) => setCategories(cats.filter((c) => c.is_active)))
        .catch(() => setCategories([]));
    }
  }

  async function selectCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedService(null);
    setPricingFields([]);
    setFieldValues({});
    setServices(null);
    try {
      const result = await authedFetch<AdminServiceResponseDto[]>(`/admin/services?category_id=${categoryId}`);
      setServices(result.filter((s) => s.is_active));
    } catch {
      setServices([]);
    }
  }

  async function selectService(serviceId: string) {
    const service = services?.find((item) => item.id === serviceId) ?? null;
    setSelectedService(service);
    setPricingFields([]);
    setFieldValues({});
    setFieldsError(null);
    if (!service || service.pricing_model !== 'formula') return;

    setFieldsLoading(true);
    try {
      const result = await authedFetch<PricingField[]>(`/admin/services/${service.id}/pricing-fields`);
      const activeFields = result.filter((field) => field.is_active).sort((a, b) => a.display_order - b.display_order);
      setPricingFields(activeFields);
      setFieldValues(Object.fromEntries(activeFields.map((field) => [field.field_key, initialFieldValue(field)])));
    } catch (err) {
      setFieldsError(err instanceof ApiError ? err.message : 'تعذّر تحميل أسئلة الخدمة');
    } finally {
      setFieldsLoading(false);
    }
  }

  function setFieldValue(key: string, value: unknown) {
    setFieldValues((current) => ({ ...current, [key]: value }));
  }

  function resetForNewOrder() {
    setSelectedCustomer(null);
    setAddresses(null);
    setSelectedAddressId('');
    setSelectedCategoryId('');
    setServices(null);
    setSelectedService(null);
    setProblemDescription('');
    setScheduledAt('');
    setPricingFields([]);
    setFieldValues({});
    setFieldsError(null);
    setCreatedOrder(null);
    setCustomers(null);
    setPhoneQuery('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer || !selectedAddressId || !selectedService) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let submittedFieldValues: Record<string, unknown> | undefined;
      if (selectedService.pricing_model === 'formula') {
        const missing = pricingFields.find((field) => {
          if (!field.is_required) return false;
          const value = fieldValues[field.field_key];
          if (field.field_type === 'checkbox') return value === null || value === undefined;
          if (Array.isArray(value)) return value.length === 0;
          return value === null || value === undefined || value === '';
        });
        if (missing) {
          setSubmitError(`جاوب على «${missing.label_ar}» الأول`);
          setSubmitting(false);
          return;
        }
        submittedFieldValues = fieldValues;
      }
      const order = await authedFetch<CreateOrderForCustomerResponseDto>('/admin/orders/for-customer', {
        method: 'POST',
        body: JSON.stringify({
          customer_user_id: selectedCustomer.user_id,
          address_id: selectedAddressId,
          service_id: selectedService.id,
          problem_description: problemDescription || undefined,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          field_values: submittedFieldValues,
        }),
      });
      setCreatedOrder(order);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'حصل خطأ في إنشاء الطلب');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <AppShell>
        <PageHeader title="إنشاء طلب نيابة عن عميل" />
        <EmptyState title="مالكش صلاحية العملية دي" description="orders.create_for_customer مش من صلاحياتك — كلّم مديرك لو محتاجها." />
      </AppShell>
    );
  }

  if (createdOrder) {
    return (
      <AppShell>
        <PageHeader title="إنشاء طلب نيابة عن عميل" />
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-emerald-600">اتعمل الطلب بنجاح</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              الطلب <span className="font-mono" dir="ltr">{createdOrder.order_number}</span> اتسجّل باسم{' '}
              <strong>{selectedCustomer?.full_name}</strong> — مصدره <Badge variant="outline">مركز الاتصال</Badge>.
            </p>
            <div className="flex gap-2">
              <Link href={`/orders/${createdOrder.id}`}>
                <Button>تفاصيل الطلب</Button>
              </Link>
              <Button variant="outline" onClick={resetForNewOrder}>
                طلب جديد
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="إنشاء طلب نيابة عن عميل"
        description="العميل صاحب الطلب دايمًا — أي طلب من هنا بيتسجّل عليه هو، وموثّق إنك أنشأته نيابة عنه."
      />

      {!selectedCustomer ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>1. دوّر على العميل برقم موبايله</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={searchCustomers} className="flex gap-2">
              <Input
                placeholder="+2010..."
                value={phoneQuery}
                onChange={(e) => setPhoneQuery(e.target.value)}
                dir="ltr"
              />
              <Button type="submit" disabled={searching}>
                {searching ? 'بيدوّر...' : 'بحث'}
              </Button>
            </form>
            {searchError && <p className="mt-2 text-sm text-destructive">{searchError}</p>}
            {customers && (
              <div className="mt-4 space-y-2">
                {customers.length === 0 ? (
                  <EmptyState title="مفيش عملاء بالرقم ده" />
                ) : (
                  customers.map((c) => (
                    <button
                      key={c.user_id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="flex w-full items-center justify-between rounded-md border p-3 text-right hover:bg-accent"
                    >
                      <div>
                        <div className="font-medium">{c.full_name}</div>
                        <div className="font-mono text-sm text-muted-foreground" dir="ltr">{c.phone_number}</div>
                      </div>
                      {c.is_blocked && <Badge variant="destructive">محظور</Badge>}
                    </button>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="max-w-xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>العميل: {selectedCustomer.full_name}</span>
                <Button variant="ghost" size="sm" onClick={resetForNewOrder}>
                  تغيير
                </Button>
              </CardTitle>
            </CardHeader>
          </Card>

          {selectedCustomer.is_blocked ? (
            <EmptyState title="العميل ده محظور" description="مينفعش تنشئ طلب لعميل محظور — فك الحظر الأول من صفحة العميل." />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>2. العنوان</CardTitle>
                </CardHeader>
                <CardContent>
                  {addresses === null ? (
                    <p className="text-sm text-muted-foreground">بيتحمّل...</p>
                  ) : addresses.length === 0 ? (
                    <EmptyState title="العميل ده مسجّلش أي عنوان لسه" description="لازم يضيف عنوان من التطبيق/الموقع بنفسه الأول." />
                  ) : (
                    <div className="space-y-2">
                      {addresses.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 rounded-md border p-2">
                          <input
                            type="radio"
                            name="address"
                            value={a.id}
                            checked={selectedAddressId === a.id}
                            onChange={() => setSelectedAddressId(a.id)}
                          />
                          <span>{a.street_name}{a.landmark ? ` — ${a.landmark}` : ''}</span>
                          {a.has_active_order && <Badge variant="outline">طلب نشط عليه</Badge>}
                        </label>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>3. الخدمة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>الفئة</Label>
                    <select
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      value={selectedCategoryId}
                      onChange={(e) => selectCategory(e.target.value)}
                    >
                      <option value="">اختار فئة</option>
                      {categories?.map((c) => (
                        <option key={c.id} value={c.id}>{c.name_ar}</option>
                      ))}
                    </select>
                  </div>
                  {services && (
                    <div>
                      <Label>الخدمة</Label>
                      <select
                        className="mt-1 w-full rounded-md border bg-background p-2"
                        value={selectedService?.id ?? ''}
                        onChange={(e) => void selectService(e.target.value)}
                      >
                        <option value="">اختار خدمة</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>{s.name_ar}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedService?.pricing_model === 'formula' && (
                    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                      <div>
                        <p className="font-medium">أسئلة تسعير الخدمة</p>
                        <p className="text-xs text-muted-foreground">اسأل العميل الأسئلة بالترتيب وسجّل إجاباته كما قالها.</p>
                      </div>
                      {fieldsLoading && <p className="text-sm text-muted-foreground">جاري تحميل الأسئلة…</p>}
                      {fieldsError && <p className="text-sm text-destructive">{fieldsError}</p>}
                      {!fieldsLoading && !fieldsError && pricingFields.length === 0 && (
                        <p className="text-sm text-muted-foreground">الخدمة دي مفيش لها أسئلة إضافية مفعّلة.</p>
                      )}
                      {pricingFields.map((field) => (
                        <DynamicPricingField
                          key={field.id}
                          field={field}
                          value={fieldValues[field.field_key]}
                          onChange={(value) => setFieldValue(field.field_key, value)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>4. تفاصيل</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>وصف المشكلة (اللي العميل قاله بالتليفون)</Label>
                    <Textarea value={problemDescription} onChange={(e) => setProblemDescription(e.target.value)} rows={3} />
                  </div>
                  <div>
                    <Label>ميعاد مطلوب (اختياري)</Label>
                    <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <Button type="submit" disabled={submitting || !selectedAddressId || !selectedService}>
                {submitting ? 'بيتسجّل...' : 'تأكيد إنشاء الطلب'}
              </Button>
            </form>
          )}
        </div>
      )}
    </AppShell>
  );
}

function DynamicPricingField({
  field,
  value,
  onChange,
}: {
  field: PricingField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = `${field.label_ar}${field.is_required ? ' *' : ' (اختياري)'}`;
  const numericTypes = ['number', 'area', 'length', 'volume'];

  if (field.field_type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-3">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span className="text-sm font-medium">{label}</span>
      </label>
    );
  }

  if (field.field_type === 'dropdown') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`pricing-${field.id}`}>{label}</Label>
        <select
          id={`pricing-${field.id}`}
          className="w-full rounded-md border bg-background p-2"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">اختار إجابة</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label_ar}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.field_type === 'multi_select') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <fieldset className="space-y-2 rounded-lg border bg-background p-3">
        <legend className="px-1 text-sm font-medium">{label}</legend>
        {(field.options ?? []).map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value),
                )
              }
            />
            {option.label_ar}
          </label>
        ))}
      </fieldset>
    );
  }

  if (field.field_type === 'slider') {
    const min = field.min_value ?? 0;
    const max = field.max_value ?? 100;
    const current = typeof value === 'number' && Number.isFinite(value) ? value : min;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`pricing-${field.id}`}>{label}</Label>
          <span className="font-semibold">{current}{field.unit_ar ? ` ${field.unit_ar}` : ''}</span>
        </div>
        <input
          id={`pricing-${field.id}`}
          type="range"
          min={min}
          max={max}
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-primary"
        />
      </div>
    );
  }

  if (numericTypes.includes(field.field_type)) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`pricing-${field.id}`}>{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`pricing-${field.id}`}
            type="number"
            min={field.min_value ?? undefined}
            max={field.max_value ?? undefined}
            value={value === '' || value === undefined ? '' : String(value)}
            onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
            dir="ltr"
          />
          {field.unit_ar && <span className="shrink-0 text-sm text-muted-foreground">{field.unit_ar}</span>}
        </div>
      </div>
    );
  }

  const uploadLike = ['image_upload', 'video_upload', 'voice_note'].includes(field.field_type);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`pricing-${field.id}`}>{label}</Label>
      <Input
        id={`pricing-${field.id}`}
        type={field.field_type === 'date' ? 'date' : field.field_type === 'time' ? 'time' : 'text'}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        placeholder={uploadLike ? 'رابط الملف لو العميل أرسله للدعم' : undefined}
        dir={field.field_type === 'date' || field.field_type === 'time' || uploadLike ? 'ltr' : 'rtl'}
      />
      {uploadLike && (
        <p className="text-xs text-muted-foreground">لو الملف مش متاح أثناء المكالمة، سيبه فاضي واطلب من العميل إرساله في الشات.</p>
      )}
    </div>
  );
}
