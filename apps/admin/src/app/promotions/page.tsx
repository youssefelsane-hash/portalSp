'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminServiceResponseDto,
  AdminServiceZoneResponseDto,
  CreatePromoCodeBody,
  DiscountType,
  PromoCodeResponseDto,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
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

  function load() {
    authedFetchPaginated<PromoCodeResponseDto>(`/admin/promo-codes?page=${page}&per_page=${PER_PAGE}`)
      .then(({ items, meta }) => {
        setPromoCodes(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل أكواد الخصم'));
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
      code: (form.get('code') as string).toUpperCase(),
      name_ar: form.get('name_ar') as string,
      discount_type: discountType,
      discount_value: discountType === 'free_inspection' ? 0 : Number(form.get('discount_value')),
      valid_from: new Date(form.get('valid_from') as string).toISOString(),
      valid_until: new Date(form.get('valid_until') as string).toISOString(),
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

    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/promo-codes', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      setSelectedServiceIds([]);
      setSelectedZoneIds([]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!window.confirm('متأكد إنك عايز تعطّل الكود ده؟')) return;
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

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">أكواد الخصم</h1>
        <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
          + كود جديد
        </Button>
      </div>

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
                <Input id="discount_value" name="discount_value" type="number" min={0} step="0.01" dir="ltr" />
              </div>
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

      {!promoCodes && <p className="text-muted-foreground">جاري التحميل…</p>}
      {promoCodes && promoCodes.length === 0 && <p className="text-muted-foreground">مفيش أكواد خصم لسه</p>}

      {promoCodes && promoCodes.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الخصم</TableHead>
                <TableHead>الاستخدام</TableHead>
                <TableHead>الميزانية المتبقية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promoCodes.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell dir="ltr">{promo.code}</TableCell>
                  <TableCell>{promo.name_ar}</TableCell>
                  <TableCell>{discountLabel(promo)}</TableCell>
                  <TableCell>
                    {promo.used_count}
                    {promo.usage_limit_total ? ` / ${promo.usage_limit_total}` : ''}
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
                    {promo.is_active && (
                      <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivate(promo.id)}>
                        تعطيل
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages} ({total} كود إجمالاً)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
