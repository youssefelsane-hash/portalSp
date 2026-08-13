'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { BuildingQrCodeResponseDto, BuildingWithSubscriptionStatusDto, CreateBuildingBody } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

// نظام العمائر (docs/08 §13, ADR-0003) — كانت فجوة موثّقة صراحة: الـAPI الكامل (إنشاء/تعديل/QR)
// كان موجود ومختبر في الباك-إند من زمان، بس مفيش شاشة أدمن كانت بتديره — الأدمن كان محتاج يعمل
// كل حاجة عبر curl/psql مباشرة، مفيش طريقة حقيقية لإنشاء عمارة جديدة أو توليد كود QR لها.
export default function BuildingsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [buildings, setBuildings] = useState<BuildingWithSubscriptionStatusDto[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [qrView, setQrView] = useState<BuildingQrCodeResponseDto | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function load() {
    authedFetch<BuildingWithSubscriptionStatusDto[]>('/admin/buildings')
      .then(setBuildings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل العمائر'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateBuildingBody = { name_ar: form.get('name_ar') as string };
    const address = form.get('address_text') as string;
    if (address) body.address_text = address;
    const discount = form.get('discount_percentage') as string;
    if (discount) body.discount_percentage = Number(discount);
    const minOrders = form.get('minimum_monthly_orders') as string;
    if (minOrders) body.minimum_monthly_orders = Number(minOrders);

    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/buildings', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive(building: BuildingWithSubscriptionStatusDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/buildings/${building.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !building.is_active }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateDiscount(id: string, discountPercentage: number, minimumMonthlyOrders: number) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/buildings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          discount_percentage: discountPercentage,
          minimum_monthly_orders: minimumMonthlyOrders,
        }),
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleShowQr(id: string) {
    setError(null);
    try {
      const result = await authedFetch<BuildingQrCodeResponseDto>(`/admin/buildings/${id}/qr`);
      setQrView(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في توليد كود QR');
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="العمائر"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + عمارة جديدة
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {qrView && (
        <Card className="mb-6">
          <CardContent className="flex items-center gap-4 pt-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrView.qr_data_uri} alt={`QR ${qrView.building_code}`} className="h-40 w-40" />
            <div>
              <p className="font-mono text-lg" dir="ltr">
                {qrView.building_code}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setQrView(null)}>
                إغلاق
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="name_ar">اسم العمارة</Label>
                <Input id="name_ar" name="name_ar" required maxLength={200} />
              </div>
              <div>
                <Label htmlFor="address_text">العنوان (اختياري)</Label>
                <Input id="address_text" name="address_text" maxLength={2000} />
              </div>
              <div>
                <Label htmlFor="discount_percentage">نسبة الخصم % (اختياري)</Label>
                <Input
                  id="discount_percentage"
                  name="discount_percentage"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  dir="ltr"
                />
              </div>
              <div>
                <Label htmlFor="minimum_monthly_orders">حد أدنى طلبات شهري (اختياري)</Label>
                <Input id="minimum_monthly_orders" name="minimum_monthly_orders" type="number" min={0} dir="ltr" />
              </div>
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit sm:col-span-2">
                إنشاء العمارة
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!buildings && <p className="text-muted-foreground">جاري التحميل…</p>}
      {buildings && buildings.length === 0 && <EmptyState title="مفيش عمائر لسه" />}

      {buildings && buildings.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الكود</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>الخصم</TableHead>
              <TableHead>الحد الأدنى الشهري</TableHead>
              <TableHead>طلبات الشهر الحالي</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.map((building) =>
              editingId === building.id ? (
                <BuildingEditRow
                  key={building.id}
                  building={building}
                  onCancel={() => setEditingId(null)}
                  onSave={handleUpdateDiscount}
                  isSaving={isSaving}
                />
              ) : (
                <TableRow key={building.id}>
                  <TableCell dir="ltr">{building.code}</TableCell>
                  <TableCell>{building.name_ar}</TableCell>
                  <TableCell>{building.discount_percentage}%</TableCell>
                  <TableCell>{building.minimum_monthly_orders}</TableCell>
                  <TableCell>
                    {building.current_month_orders_count}
                    {building.meets_minimum_monthly_orders ? (
                      <Badge variant="secondary" className="mr-2">
                        محقّق
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={building.is_active ? 'secondary' : 'outline'}>
                      {building.is_active ? 'نشطة' : 'معطّلة'}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => handleShowQr(building.id)}>
                      QR
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(building.id)}>
                      تعديل
                    </Button>
                    <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleToggleActive(building)}>
                      {building.is_active ? 'تعطيل' : 'تفعيل'}
                    </Button>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}

function BuildingEditRow({
  building,
  onCancel,
  onSave,
  isSaving,
}: {
  building: BuildingWithSubscriptionStatusDto;
  onCancel: () => void;
  onSave: (id: string, discountPercentage: number, minimumMonthlyOrders: number) => void;
  isSaving: boolean;
}) {
  const [discount, setDiscount] = useState(String(building.discount_percentage));
  const [minOrders, setMinOrders] = useState(String(building.minimum_monthly_orders));

  return (
    <TableRow>
      <TableCell dir="ltr">{building.code}</TableCell>
      <TableCell>{building.name_ar}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.01"
          dir="ltr"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          className="w-24"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          dir="ltr"
          value={minOrders}
          onChange={(e) => setMinOrders(e.target.value)}
          className="w-24"
        />
      </TableCell>
      <TableCell>{building.current_month_orders_count}</TableCell>
      <TableCell>
        <Badge variant={building.is_active ? 'secondary' : 'outline'}>{building.is_active ? 'نشطة' : 'معطّلة'}</Badge>
      </TableCell>
      <TableCell className="flex gap-2">
        <Button
          size="sm"
          disabled={isSaving}
          onClick={() => onSave(building.id, Number(discount), Number(minOrders))}
        >
          حفظ
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          إلغاء
        </Button>
      </TableCell>
    </TableRow>
  );
}
