'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminServiceResponseDto,
  AdminServiceZoneResponseDto,
  CreatePromoCodeBody,
  DiscountType,
  MarketingChannel,
  PromoMarketingCommissionDto,
  PromoCodeResponseDto,
} from '@baytak/shared-types';
import { MARKETING_CHANNELS, MARKETING_CHANNEL_LABELS_AR } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { PromoCodeQr } from '@/components/promo-code-qr';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const PER_PAGE = 20;

const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  percentage: 'نسبة مئوية',
  fixed_amount: 'مبلغ ثابت',
  free_inspection: 'كشف مجاني',
};

function discountLabel(promo: PromoCodeResponseDto): string {
  if (promo.discount_type === 'percentage') return `${promo.discount_value}%`;
  if (promo.discount_type === 'fixed_amount') return formatEgp(promo.discount_value * 100);
  return 'كشف مجاني';
}

export default function PromotionsPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [promoCodes, setPromoCodes] = useState<PromoCodeResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [services, setServices] = useState<AdminServiceResponseDto[]>([]);
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [commissions, setCommissions] = useState<PromoMarketingCommissionDto[]>([]);

  function load() {
    authedFetchPaginated<PromoCodeResponseDto>(`/admin/promo-codes?page=${page}&per_page=${PER_PAGE}`)
      .then(({ items, meta }) => {
        setPromoCodes(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل أكواد الخصم'));
    authedFetch<PromoMarketingCommissionDto[]>('/admin/promo-codes/marketing-commissions?status=accrued')
      .then(setCommissions)
      .catch(() => setCommissions([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, page]);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<AdminServiceResponseDto[]>('/admin/services').then(setServices).catch(() => setServices([]));
    authedFetch<AdminServiceZoneResponseDto[]>('/admin/service-zones').then(setZones).catch(() => setZones([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const discountType = form.get('discount_type') as DiscountType;
    const body: CreatePromoCodeBody = {
      code: (form.get('code') as string).trim().toUpperCase(),
      name_ar: form.get('name_ar') as string,
      discount_type: discountType,
      discount_value: !discountEnabled || discountType === 'free_inspection' ? 0 : Number(form.get('discount_value')),
      discount_enabled: discountEnabled,
      // `type=date` بلا وقت؛ من تاريخ يبدأ من أوله، و"لحد تاريخ" لازم يظل صالحًا حتى آخره.
      valid_from: new Date(`${form.get('valid_from') as string}T00:00:00`).toISOString(),
      valid_until: new Date(`${form.get('valid_until') as string}T23:59:59.999`).toISOString(),
      new_customers_only: form.get('new_customers_only') === 'on',
    };
    const minOrder = form.get('min_order_amount_cents') as string;
    if (minOrder) body.min_order_amount_cents = Math.round(Number(minOrder) * 100);
    const usageLimit = form.get('usage_limit_total') as string;
    if (usageLimit) body.usage_limit_total = Number(usageLimit);
    const usageLimitPerUser = form.get('usage_limit_per_user') as string;
    if (usageLimitPerUser) body.usage_limit_per_user = Number(usageLimitPerUser);
    const budget = form.get('budget_cents') as string;
    if (budget) body.budget_cents = Math.round(Number(budget) * 100);
    if (selectedServiceIds.length > 0) body.applies_to_service_ids = selectedServiceIds;
    if (selectedZoneIds.length > 0) body.applies_to_zone_ids = selectedZoneIds;
    const marketingChannel = form.get('marketing_channel') as MarketingChannel;
    if (marketingChannel) body.marketing_channel = marketingChannel;
    const marketingRegion = (form.get('marketing_region_label') as string).trim();
    if (marketingRegion) body.marketing_region_label = marketingRegion;
    const marketingNotes = (form.get('marketing_notes') as string).trim();
    if (marketingNotes) body.marketing_notes = marketingNotes;
    const payout = form.get('payout_per_completed_order_cents') as string;
    if (payout) body.payout_per_completed_order_cents = Math.round(Number(payout) * 100);
    const payoutContact = (form.get('payout_contact_name') as string).trim();
    if (payoutContact) body.payout_contact_name = payoutContact;
    const payoutPhone = (form.get('payout_contact_phone') as string).trim();
    if (payoutPhone) body.payout_contact_phone = payoutPhone;

    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/promo-codes', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      setSelectedServiceIds([]);
      setSelectedZoneIds([]);
      setDiscountEnabled(true);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/promo-codes/${id}/deactivate`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function markCommissionPaid(ids: string[]) {
    if (ids.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/promo-codes/marketing-commissions/mark-paid', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تعليم المستحقات كمدفوعة');
    } finally {
      setIsSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader
        title="العروض والتسويق"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + كود جديد
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="code">الكود</Label>
                <Input id="code" name="code" required minLength={3} maxLength={24} dir="ltr" className="uppercase" />
              </div>
              <div>
                <Label htmlFor="name_ar">الاسم</Label>
                <Input id="name_ar" name="name_ar" required maxLength={120} />
              </div>
              <div>
                <Label htmlFor="discount_type">نوع الخصم</Label>
                <SelectNative id="discount_type" name="discount_type" defaultValue="percentage">
                  {Object.entries(DISCOUNT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <Label htmlFor="discount_value">قيمة الخصم (نسبة % أو جنيه)</Label>
                <Input id="discount_value" name="discount_value" type="number" min={0} step="0.01" dir="ltr" disabled={!discountEnabled} />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={discountEnabled} onChange={(e) => setDiscountEnabled(e.target.checked)} />
                الكود يمنح خصمًا عند الحجز
              </label>
              {!discountEnabled && (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  كود تسويق وإسناد فقط: يقيس الزيارات والتسجيلات ويمكن أن ينشئ مستحق شريك، لكنه لا يغيّر سعر العميل.
                </p>
              )}
              <div>
                <Label htmlFor="valid_from">من تاريخ</Label>
                <Input id="valid_from" name="valid_from" type="date" required dir="ltr" />
              </div>
              <div>
                <Label htmlFor="valid_until">لحد تاريخ</Label>
                <Input id="valid_until" name="valid_until" type="date" required dir="ltr" />
              </div>
              <div>
                <Label htmlFor="min_order_amount_cents">أقل قيمة طلب (جنيه، اختياري)</Label>
                <Input id="min_order_amount_cents" name="min_order_amount_cents" type="number" min={0} step="0.01" dir="ltr" />
              </div>
              <div>
                <Label htmlFor="budget_cents">ميزانية الكود (جنيه، اختياري)</Label>
                <Input id="budget_cents" name="budget_cents" type="number" min={0} step="0.01" dir="ltr" />
              </div>
              <div>
                <Label htmlFor="usage_limit_total">حد الاستخدام الكلي (اختياري)</Label>
                <Input id="usage_limit_total" name="usage_limit_total" type="number" min={1} dir="ltr" />
              </div>
              <div>
                <Label htmlFor="usage_limit_per_user">حد الاستخدام للمستخدم (اختياري، افتراضي 1)</Label>
                <Input id="usage_limit_per_user" name="usage_limit_per_user" type="number" min={1} dir="ltr" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="new_customers_only" />
                عملاء جداد بس
              </label>

              <div className="border-t pt-3 sm:col-span-2">
                <p className="mb-3 font-medium">التسويق والإسناد (اختياري)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="marketing_channel">قناة المصدر</Label>
                    <SelectNative id="marketing_channel" name="marketing_channel" defaultValue="">
                      <option value="">بدون إسناد تسويقي</option>
                      {MARKETING_CHANNELS.map((channel) => <option key={channel} value={channel}>{MARKETING_CHANNEL_LABELS_AR[channel]}</option>)}
                    </SelectNative>
                  </div>
                  <div>
                    <Label htmlFor="marketing_region_label">وصف منطقة الحملة (اختياري)</Label>
                    <Input id="marketing_region_label" name="marketing_region_label" maxLength={120} placeholder="مثال: سموحة" />
                  </div>
                  <div>
                    <Label htmlFor="payout_per_completed_order_cents">مستحق الشريك لكل أول طلب مكتمل (جنيه)</Label>
                    <Input id="payout_per_completed_order_cents" name="payout_per_completed_order_cents" type="number" min={0} step="0.01" dir="ltr" />
                  </div>
                  <div>
                    <Label htmlFor="payout_contact_name">اسم الشريك (اختياري)</Label>
                    <Input id="payout_contact_name" name="payout_contact_name" maxLength={120} />
                  </div>
                  <div>
                    <Label htmlFor="payout_contact_phone">رقم الشريك (اختياري)</Label>
                    <Input id="payout_contact_phone" name="payout_contact_phone" maxLength={20} dir="ltr" />
                  </div>
                  <div>
                    <Label htmlFor="marketing_notes">ملاحظات داخلية (اختياري)</Label>
                    <Input id="marketing_notes" name="marketing_notes" maxLength={2000} />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label>مقصور على خدمات معيّنة (اختياري، فاضي = كل الخدمات)</Label>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-2">
                  {services.length === 0 && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                  {services.map((service) => (
                    <label key={service.id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedServiceIds.includes(service.id)}
                        onChange={(e) =>
                          setSelectedServiceIds((prev) =>
                            e.target.checked ? [...prev, service.id] : prev.filter((id) => id !== service.id),
                          )
                        }
                      />
                      {service.name_ar}
                    </label>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <Label>مقصور على مناطق خدمة معيّنة (اختياري، فاضي = كل المناطق)</Label>
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-2">
                  {zones.length === 0 && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                  {zones.map((zone) => (
                    <label key={zone.id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedZoneIds.includes(zone.id)}
                        onChange={(e) =>
                          setSelectedZoneIds((prev) =>
                            e.target.checked ? [...prev, zone.id] : prev.filter((id) => id !== zone.id),
                          )
                        }
                      />
                      {zone.name_ar}
                    </label>
                  ))}
                </div>
              </div>

              <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-2">
                حفظ الكود
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!promoCodes && <TableSkeleton columns={9} />}
      {promoCodes && promoCodes.length === 0 && <EmptyState title="مفيش أكواد خصم لسه" />}

      {promoCodes && promoCodes.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الخصم</TableHead>
                <TableHead>القيود</TableHead>
                <TableHead>الرحلة</TableHead>
                <TableHead>النتيجة</TableHead>
                <TableHead>الميزانية المتبقية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>QR</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promoCodes.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell dir="ltr">{promo.code}</TableCell>
                  <TableCell>{promo.name_ar}</TableCell>
                  <TableCell>{promo.discount_enabled ? discountLabel(promo) : 'إسناد فقط'}</TableCell>
                  <TableCell>
                    {promo.used_count}
                    {promo.usage_limit_total ? ` / ${promo.usage_limit_total}` : ''}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {promo.link_hit_count} / {promo.link_signup_count}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {promo.attributed_completed_order_count} مكتمل · {formatEgp(promo.attributed_gross_revenue_cents)}
                    {promo.marketing_channel && <span className="mt-1 block text-xs text-muted-foreground">{MARKETING_CHANNEL_LABELS_AR[promo.marketing_channel]}</span>}
                  </TableCell>
                  <TableCell>
                    {promo.budget_cents !== null ? formatEgp(promo.budget_cents - promo.spent_cents) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={promo.is_active ? 'secondary' : 'outline'}>
                      {promo.is_active ? 'مفعّل' : 'معطّل'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PromoCodeQr value={promo.share_url} label={`كود ${promo.code}`} caption={promo.share_url} />
                  </TableCell>
                  <TableCell>
                    {promo.is_active && (
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="ghost" disabled={isSaving}>
                            تعطيل
                          </Button>
                        }
                        title="متأكد إنك عايز تعطّل الكود ده؟"
                        confirmLabel="تعطيل"
                        onConfirm={() => handleDeactivate(promo.id)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="كود" onPageChange={setPage} />
        </>
      )}

      {commissions.length > 0 && (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">مستحقات شركاء العروض</h2>
                <p className="text-sm text-muted-foreground">تُعلّم مدفوعة يدويًا فقط؛ لا يوجد سحب أو تحويل تلقائي للأموال.</p>
              </div>
              <Button size="sm" disabled={isSaving} onClick={() => markCommissionPaid(commissions.map((commission) => commission.id))}>
                تعليم الكل مدفوعًا
              </Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الطلب</TableHead><TableHead>المبلغ</TableHead></TableRow></TableHeader>
              <TableBody>{commissions.map((commission) => {
                const promo = promoCodes?.find((item) => item.id === commission.promoCodeId);
                return <TableRow key={commission.id}><TableCell dir="ltr">{promo?.code ?? commission.promoCodeId}</TableCell><TableCell dir="ltr">{commission.orderId}</TableCell><TableCell>{formatEgp(commission.amountCents)}</TableCell></TableRow>;
              })}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
