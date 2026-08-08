'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AdminServiceResponseDto,
  AdminServiceZoneResponseDto,
  AdminTechnicianResponseDto,
  AssignTechnicianServiceBody,
  CreateServiceAddonBody,
  EligibleTechnicianResponseDto,
  ServiceAddonResponseDto,
  ServiceLevelPricingResponseDto,
  ServiceZonePricingResponseDto,
  SkillLevel,
  TechnicianLevel,
  UpdateServiceBody,
  UpsertLevelPricingBody,
  UpsertZonePricingBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const TECHNICIAN_LEVEL_LABELS: Record<TechnicianLevel, string> = {
  new: 'جديد',
  verified: 'موثّق',
  professional: 'محترف',
  premium: 'مميّز',
  team_leader: 'قائد فريق',
};

const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'مبتدئ',
  standard: 'عادي',
  expert: 'خبير',
};

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [service, setService] = useState<AdminServiceResponseDto | null>(null);
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [zonePricing, setZonePricing] = useState<ServiceZonePricingResponseDto[] | null>(null);
  const [approvedTechnicians, setApprovedTechnicians] = useState<AdminTechnicianResponseDto[] | null>(null);
  const [eligibleTechnicians, setEligibleTechnicians] = useState<EligibleTechnicianResponseDto[] | null>(null);
  const [levelPricing, setLevelPricing] = useState<ServiceLevelPricingResponseDto[] | null>(null);
  const [addons, setAddons] = useState<ServiceAddonResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showNewAddon, setShowNewAddon] = useState(false);

  function loadAll() {
    // مفيش GET /admin/services/:id مفرد — بنلاقيه جوّه القايمة الكاملة بدل endpoint مخصص
    authedFetch<AdminServiceResponseDto[]>('/admin/services')
      .then((all) => setService(all.find((s) => s.id === id) ?? null))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الخدمة'));
    authedFetch<AdminServiceZoneResponseDto[]>('/admin/service-zones').then(setZones).catch(() => setZones([]));
    authedFetch<ServiceZonePricingResponseDto[]>(`/admin/services/${id}/zone-pricing`).then(setZonePricing).catch(() => setZonePricing([]));
    // ResponseInterceptor بيفكّ {items, meta} ويحط items في data مباشرة — يعني authedFetch العادي
    // (مش authedFetchPaginated) بيرجّع المصفوفة على طول من غير غلاف إضافي.
    authedFetch<AdminTechnicianResponseDto[]>('/admin/technicians?verification_status=approved&per_page=100')
      .then(setApprovedTechnicians)
      .catch(() => setApprovedTechnicians([]));
    authedFetch<EligibleTechnicianResponseDto[]>(`/admin/services/${id}/technicians`).then(setEligibleTechnicians).catch(() => setEligibleTechnicians([]));
    authedFetch<ServiceLevelPricingResponseDto[]>(`/admin/services/${id}/level-pricing`).then(setLevelPricing).catch(() => setLevelPricing([]));
    authedFetch<ServiceAddonResponseDto[]>(`/admin/services/${id}/addons`).then(setAddons).catch(() => setAddons([]));
  }

  useEffect(() => {
    if (isLoading) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  function technicianName(technicianId: string): string {
    const tech = approvedTechnicians?.find((t) => t.id === technicianId);
    return tech ? `${tech.full_name} (${tech.technician_code})` : technicianId;
  }

  function zoneName(zoneId: string): string {
    const zone = zones?.find((z) => z.id === zoneId);
    return zone ? zone.name_ar : zoneId;
  }

  async function handleUpsertZonePricing(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: UpsertZonePricingBody = {
      service_zone_id: form.get('service_zone_id') as string,
      price_cents: Math.round(Number(form.get('price')) * 100),
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/zone-pricing`, { method: 'PUT', body: JSON.stringify(body) });
      (e.target as HTMLFormElement).reset();
      authedFetch<ServiceZonePricingResponseDto[]>(`/admin/services/${id}/zone-pricing`).then(setZonePricing);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeactivateZonePricing(pricingId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/zone-pricing/${pricingId}`, { method: 'DELETE' });
      authedFetch<ServiceZonePricingResponseDto[]>(`/admin/services/${id}/zone-pricing`).then(setZonePricing);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAssignTechnician(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: AssignTechnicianServiceBody = {
      technician_id: form.get('technician_id') as string,
      skill_level: (form.get('skill_level') as SkillLevel) || undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/technicians`, { method: 'POST', body: JSON.stringify(body) });
      (e.target as HTMLFormElement).reset();
      authedFetch<EligibleTechnicianResponseDto[]>(`/admin/services/${id}/technicians`).then(setEligibleTechnicians);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveTechnician(technicianId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/technicians/${technicianId}`, { method: 'DELETE' });
      authedFetch<EligibleTechnicianResponseDto[]>(`/admin/services/${id}/technicians`).then(setEligibleTechnicians);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpsertLevelPricing(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: UpsertLevelPricingBody = {
      technician_level: form.get('technician_level') as TechnicianLevel,
      price_multiplier: Number(form.get('price_multiplier')),
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/level-pricing`, { method: 'PUT', body: JSON.stringify(body) });
      (e.target as HTMLFormElement).reset();
      authedFetch<ServiceLevelPricingResponseDto[]>(`/admin/services/${id}/level-pricing`).then(setLevelPricing);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAddon(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateServiceAddonBody = {
      name_ar: form.get('name_ar') as string,
      price_cents: Math.round(Number(form.get('price')) * 100),
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/addons`, { method: 'POST', body: JSON.stringify(body) });
      setShowNewAddon(false);
      authedFetch<ServiceAddonResponseDto[]>(`/admin/services/${id}/addons`).then(setAddons);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleAddonActive(addon: ServiceAddonResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/addons/${addon.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !addon.is_active }) });
      authedFetch<ServiceAddonResponseDto[]>(`/admin/services/${id}/addons`).then(setAddons);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateServiceDetails(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const minPrice = form.get('min_price') as string;
    const maxPrice = form.get('max_price') as string;
    const body: UpdateServiceBody = {
      short_description_ar: (form.get('short_description_ar') as string) || undefined,
      min_price_cents: minPrice ? Math.round(Number(minPrice) * 100) : undefined,
      max_price_cents: maxPrice ? Math.round(Number(maxPrice) * 100) : undefined,
      warranty_days: Number(form.get('warranty_days')),
      estimated_duration_minutes: form.get('estimated_duration_minutes')
        ? Number(form.get('estimated_duration_minutes'))
        : undefined,
      requires_photos: form.get('requires_photos') === 'on',
      allows_scheduling: form.get('allows_scheduling') === 'on',
      allows_emergency: form.get('allows_emergency') === 'on',
    };
    setIsSaving(true);
    setError(null);
    try {
      const updated = await authedFetch<AdminServiceResponseDto>(`/admin/services/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setService(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (!service) {
    return (
      <AppShell>
        <p className="text-muted-foreground">{error ?? 'جاري التحميل…'}</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{service.name_ar}</h1>
        <Button variant="outline" onClick={() => router.push('/catalog')}>
          رجوع للكتالوج
        </Button>
      </div>
      {error && <p className="mb-4 text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">تفاصيل الخدمة</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateServiceDetails} className="flex flex-col gap-3">
            <Label htmlFor="svc_desc">وصف مختصر</Label>
            <Input id="svc_desc" name="short_description_ar" defaultValue={service.short_description_ar ?? ''} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_min_price">أقل سعر (جنيه)</Label>
                <Input
                  id="svc_min_price"
                  name="min_price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={service.min_price_cents !== null ? service.min_price_cents / 100 : ''}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_max_price">أعلى سعر (جنيه)</Label>
                <Input
                  id="svc_max_price"
                  name="max_price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={service.max_price_cents !== null ? service.max_price_cents / 100 : ''}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_warranty">أيام الضمان</Label>
                <Input id="svc_warranty" name="warranty_days" type="number" min="0" defaultValue={service.warranty_days} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_duration">المدة المتوقعة (دقيقة)</Label>
                <Input
                  id="svc_duration"
                  name="estimated_duration_minutes"
                  type="number"
                  min="1"
                  defaultValue={service.estimated_duration_minutes ?? ''}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="requires_photos" defaultChecked={service.requires_photos} />
                محتاجة صور قبل/بعد
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allows_scheduling" defaultChecked={service.allows_scheduling} />
                يسمح بالحجز المجدول
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allows_emergency" defaultChecked={service.allows_emergency} />
                يسمح بطلب طارئ
              </label>
            </div>
            <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
              حفظ تفاصيل الخدمة
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">تسعير حسب المنطقة</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpsertZonePricing} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="zp_zone">المنطقة</Label>
              <SelectNative id="zp_zone" name="service_zone_id" required defaultValue="">
                <option value="" disabled>
                  اختار نطاق خدمة
                </option>
                {zones?.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name_ar}
                  </option>
                ))}
              </SelectNative>
              <Label htmlFor="zp_price">السعر (جنيه)</Label>
              <Input id="zp_price" name="price" type="number" min="0" step="0.01" required />
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                حفظ تسعير المنطقة
              </Button>
            </form>
            {!zonePricing ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : zonePricing.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش تسعير مخصص لمناطق — بيستخدم السعر الأساسي</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنطقة</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zonePricing.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{zoneName(p.service_zone_id)}</TableCell>
                      <TableCell>{formatEgp(p.price_cents)}</TableCell>
                      <TableCell>
                        <Badge variant={p.is_active ? 'secondary' : 'outline'}>{p.is_active ? 'نشط' : 'معطّل'}</Badge>
                      </TableCell>
                      <TableCell>
                        {p.is_active && (
                          <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeactivateZonePricing(p.id)}>
                            تعطيل
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">الفنيين المؤهلين</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAssignTechnician} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="et_tech">الفني</Label>
              <SelectNative id="et_tech" name="technician_id" required defaultValue="">
                <option value="" disabled>
                  اختار فني
                </option>
                {approvedTechnicians?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} ({t.technician_code})
                  </option>
                ))}
              </SelectNative>
              <Label htmlFor="et_skill">مستوى المهارة</Label>
              <SelectNative id="et_skill" name="skill_level" defaultValue="standard">
                {Object.entries(SKILL_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectNative>
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                إضافة فني
              </Button>
            </form>
            {!eligibleTechnicians ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : eligibleTechnicians.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش فنيين مؤهلين للخدمة دي لسه</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفني</TableHead>
                    <TableHead>المهارة</TableHead>
                    <TableHead>عدد الطلبات المكتملة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleTechnicians.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{technicianName(t.technician_id)}</TableCell>
                      <TableCell>{SKILL_LEVEL_LABELS[t.skill_level]}</TableCell>
                      <TableCell>{t.completed_count}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleRemoveTechnician(t.technician_id)}>
                          إزالة
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">تسعير حسب مستوى الفني</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpsertLevelPricing} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="lp_level">المستوى</Label>
              <SelectNative id="lp_level" name="technician_level" required defaultValue="">
                <option value="" disabled>
                  اختار مستوى
                </option>
                {Object.entries(TECHNICIAN_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectNative>
              <Label htmlFor="lp_multiplier">مضاعف السعر</Label>
              <Input id="lp_multiplier" name="price_multiplier" type="number" min="0.1" step="0.05" required />
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                حفظ مضاعف المستوى
              </Button>
            </form>
            {!levelPricing ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : levelPricing.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش تسعير مخصص للمستويات — كل المستويات بنفس السعر الأساسي</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المستوى</TableHead>
                    <TableHead>المضاعف</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {levelPricing.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{TECHNICIAN_LEVEL_LABELS[p.technician_level]}</TableCell>
                      <TableCell dir="ltr">{p.price_multiplier}×</TableCell>
                      <TableCell>
                        <Badge variant={p.is_active ? 'secondary' : 'outline'}>{p.is_active ? 'نشط' : 'معطّل'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">الإضافات الاختيارية</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowNewAddon((s) => !s)}>
              + إضافة جديدة
            </Button>
          </CardHeader>
          <CardContent>
            {showNewAddon && (
              <form onSubmit={handleCreateAddon} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                <Input name="name_ar" placeholder="اسم الإضافة بالعربي" required />
                <Input name="price" type="number" min="0" step="0.01" placeholder="السعر (جنيه)" required />
                <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                  حفظ الإضافة
                </Button>
              </form>
            )}
            {!addons ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : addons.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش إضافات اختيارية للخدمة دي لسه</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addons.map((addon) => (
                    <TableRow key={addon.id}>
                      <TableCell>{addon.name_ar}</TableCell>
                      <TableCell>{formatEgp(addon.price_cents)}</TableCell>
                      <TableCell>
                        <button type="button" disabled={isSaving} onClick={() => toggleAddonActive(addon)} className="cursor-pointer">
                          <Badge variant={addon.is_active ? 'secondary' : 'outline'}>{addon.is_active ? 'نشطة' : 'معطّلة'}</Badge>
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
