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
  const [fieldValuesJson, setFieldValuesJson] = useState('{}');

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
    setServices(null);
    try {
      const result = await authedFetch<AdminServiceResponseDto[]>(`/admin/services?category_id=${categoryId}`);
      setServices(result.filter((s) => s.is_active));
    } catch {
      setServices([]);
    }
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
    setFieldValuesJson('{}');
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
      let fieldValues: Record<string, unknown> | undefined;
      if (selectedService.pricing_model === 'formula') {
        try {
          fieldValues = JSON.parse(fieldValuesJson || '{}');
        } catch {
          setSubmitError('صيغة field_values JSON غلط — راجعها');
          setSubmitting(false);
          return;
        }
      }
      const order = await authedFetch<CreateOrderForCustomerResponseDto>('/admin/orders/for-customer', {
        method: 'POST',
        body: JSON.stringify({
          customer_user_id: selectedCustomer.user_id,
          address_id: selectedAddressId,
          service_id: selectedService.id,
          problem_description: problemDescription || undefined,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          field_values: fieldValues,
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
                        onChange={(e) => setSelectedService(services.find((s) => s.id === e.target.value) ?? null)}
                      >
                        <option value="">اختار خدمة</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>{s.name_ar}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedService?.pricing_model === 'formula' && (
                    <div>
                      <Label>field_values (JSON) — نفس أسئلة الخدمة في تطبيق العميل</Label>
                      <Textarea
                        className="mt-1 font-mono"
                        dir="ltr"
                        rows={4}
                        value={fieldValuesJson}
                        onChange={(e) => setFieldValuesJson(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        الخدمة دي تسعيرها ديناميكي (formula) — اسأل العميل نفس أسئلة الحجز العادي واملأها هنا كـJSON.
                      </p>
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
