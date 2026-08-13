'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AdminServiceResponseDto,
  AdminServiceZoneResponseDto,
  AdminTechnicianResponseDto,
  AssignTechnicianServiceBody,
  CreateServiceAddonBody,
  CreateServiceStandardDataBody,
  EligibleTechnicianResponseDto,
  PricingModel,
  RecordProductivityActualBody,
  ServiceAddonResponseDto,
  ServiceLevelPricingResponseDto,
  ServiceProductivityActualResponseDto,
  ServiceStandardDataResponseDto,
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { PricingBuilder } from './pricing-builder';

const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'ثابت',
  hourly: 'بالساعة',
  per_unit: 'بالوحدة',
  inspection_then_quote: 'كشف ثم عرض سعر',
  formula: 'معادلة ديناميكية',
};

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
  const [standardData, setStandardData] = useState<ServiceStandardDataResponseDto[] | null>(null);
  const [actualsByStandardData, setActualsByStandardData] = useState<Record<string, ServiceProductivityActualResponseDto[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showNewAddon, setShowNewAddon] = useState(false);
  const [showNewStandardData, setShowNewStandardData] = useState(false);
  const [actualsFormOpenFor, setActualsFormOpenFor] = useState<string | null>(null);

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
    authedFetch<ServiceStandardDataResponseDto[]>(`/admin/services/${id}/standard-data`).then(setStandardData).catch(() => setStandardData([]));
  }

  function loadActuals(standardDataId: string) {
    authedFetch<ServiceProductivityActualResponseDto[]>(`/admin/services/standard-data/${standardDataId}/actuals`)
      .then((rows) => setActualsByStandardData((prev) => ({ ...prev, [standardDataId]: rows })))
      .catch(() => setActualsByStandardData((prev) => ({ ...prev, [standardDataId]: [] })));
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
    const validFrom = form.get('valid_from') as string;
    const body: UpsertZonePricingBody = {
      service_zone_id: form.get('service_zone_id') as string,
      price_cents: Math.round(Number(form.get('price')) * 100),
      // تاريخ سريان (docs/06 §3.10) — فاضي = فوري (النهاردة). تاريخ مستقبلي = جدولة سعر
      // جاي من غير ما يأثر على أي حاجة دلوقتي (تفاصيل في catalog/README.md).
      valid_from: validFrom ? new Date(validFrom).toISOString() : undefined,
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

  async function handleCreateStandardData(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const assistantWage = form.get('assistant_daily_wage_cents') as string;
    const body: CreateServiceStandardDataBody = {
      execution_type_ar: (form.get('execution_type_ar') as string) || undefined,
      unit_ar: form.get('unit_ar') as string,
      technician_daily_wage_cents: Math.round(Number(form.get('technician_daily_wage')) * 100),
      assistant_daily_wage_cents: assistantWage ? Math.round(Number(assistantWage) * 100) : undefined,
      productivity_per_day: Number(form.get('productivity_per_day')),
      min_technicians: form.get('min_technicians') ? Number(form.get('min_technicians')) : undefined,
      min_assistants: form.get('min_assistants') ? Number(form.get('min_assistants')) : undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${id}/standard-data`, { method: 'POST', body: JSON.stringify(body) });
      setShowNewStandardData(false);
      authedFetch<ServiceStandardDataResponseDto[]>(`/admin/services/${id}/standard-data`).then(setStandardData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStandardDataActive(row: ServiceStandardDataResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/standard-data/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      authedFetch<ServiceStandardDataResponseDto[]>(`/admin/services/${id}/standard-data`).then(setStandardData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteStandardData(standardDataId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/standard-data/${standardDataId}`, { method: 'DELETE' });
      authedFetch<ServiceStandardDataResponseDto[]>(`/admin/services/${id}/standard-data`).then(setStandardData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  function toggleActualsForm(standardDataId: string) {
    const opening = actualsFormOpenFor !== standardDataId;
    setActualsFormOpenFor(opening ? standardDataId : null);
    if (opening && !actualsByStandardData[standardDataId]) {
      loadActuals(standardDataId);
    }
  }

  async function handleRecordActual(e: FormEvent, standardDataId: string) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: RecordProductivityActualBody = {
      actual_units: Number(form.get('actual_units')),
      actual_days: Number(form.get('actual_days')),
      actual_technicians: Number(form.get('actual_technicians')),
      actual_assistants: form.get('actual_assistants') ? Number(form.get('actual_assistants')) : 0,
      notes: (form.get('notes') as string) || undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/standard-data/${standardDataId}/actuals`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      (e.target as HTMLFormElement).reset();
      loadActuals(standardDataId);
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
    const basePrice = form.get('base_price') as string;
    const inspectionFee = form.get('inspection_fee') as string;
    const commission = form.get('commission_percentage') as string;
    const displayOrder = form.get('display_order') as string;
    const launchPhase = form.get('launch_phase') as string;
    const minTechnicianLevel = form.get('min_technician_level') as string;
    const body: UpdateServiceBody = {
      name_en: (form.get('name_en') as string) || undefined,
      short_description_ar: (form.get('short_description_ar') as string) || undefined,
      full_description_ar: (form.get('full_description_ar') as string) || undefined,
      icon_url: (form.get('icon_url') as string) || undefined,
      pricing_model: form.get('pricing_model') as UpdateServiceBody['pricing_model'],
      // كانت فجوة موثّقة صراحة: مفيش طريقة تعدّل السعر الأساسي لخدمة قائمة من غير SQL مباشر —
      // أدمن يعمل خدمة fixed بـ1000ج.م. وبعد أسبوع يحتاج يخليها 1200ج.م.، الواجهة ماكانتش بتوفر ده.
      base_price_cents: basePrice ? Math.round(Number(basePrice) * 100) : undefined,
      inspection_fee_cents: inspectionFee ? Math.round(Number(inspectionFee) * 100) : undefined,
      unit_name_ar: (form.get('unit_name_ar') as string) || undefined,
      min_price_cents: minPrice ? Math.round(Number(minPrice) * 100) : undefined,
      max_price_cents: maxPrice ? Math.round(Number(maxPrice) * 100) : undefined,
      warranty_days: Number(form.get('warranty_days')),
      estimated_duration_minutes: form.get('estimated_duration_minutes')
        ? Number(form.get('estimated_duration_minutes'))
        : undefined,
      requires_photos: form.get('requires_photos') === 'on',
      allows_scheduling: form.get('allows_scheduling') === 'on',
      allows_emergency: form.get('allows_emergency') === 'on',
      allows_individual: form.get('allows_individual') === 'on',
      allows_team: form.get('allows_team') === 'on',
      min_technician_level: (minTechnicianLevel as TechnicianLevel) || undefined,
      commission_percentage: commission ? Number(commission) : undefined,
      display_order: displayOrder ? Number(displayOrder) : undefined,
      launch_phase: launchPhase ? Number(launchPhase) : undefined,
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
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_name_en">الاسم بالإنجليزي</Label>
                <Input id="svc_name_en" name="name_en" defaultValue={service.name_en ?? ''} dir="ltr" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_icon_url">رابط الأيقونة</Label>
                <Input id="svc_icon_url" name="icon_url" defaultValue={service.icon_url ?? ''} dir="ltr" />
              </div>
            </div>
            <Label htmlFor="svc_desc">وصف مختصر</Label>
            <Input id="svc_desc" name="short_description_ar" defaultValue={service.short_description_ar ?? ''} />
            <Label htmlFor="svc_full_desc">وصف كامل</Label>
            <Textarea id="svc_full_desc" name="full_description_ar" defaultValue={service.full_description_ar ?? ''} rows={2} />
            <div className="flex flex-col gap-1">
              <Label htmlFor="svc_pricing_model">نوع التسعير</Label>
              <SelectNative id="svc_pricing_model" name="pricing_model" defaultValue={service.pricing_model} className="max-w-xs">
                {Object.entries(PRICING_MODEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectNative>
              {service.pricing_model === 'formula' && (
                <p className="text-sm text-muted-foreground">
                  السعر الأساسي تحت مش مستخدم — السعر بيتحسب بالكامل من محرك التسعير الديناميكي.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                {/* كانت فجوة موثّقة صراحة: مفيش طريقة تعدّل السعر الأساسي بعد إنشاء الخدمة من
                    غير SQL مباشر — العنصر الوحيد المفروض الأدمن يتحكم فيه من غير كود. */}
                <Label htmlFor="svc_base_price">السعر الأساسي (جنيه)</Label>
                <Input
                  id="svc_base_price"
                  name="base_price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={service.base_price_cents / 100}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_inspection_fee">رسوم الكشف (جنيه)</Label>
                <Input
                  id="svc_inspection_fee"
                  name="inspection_fee"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={service.inspection_fee_cents / 100}
                />
              </div>
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
                <Label htmlFor="svc_unit">اسم الوحدة</Label>
                <Input id="svc_unit" name="unit_name_ar" defaultValue={service.unit_name_ar ?? ''} />
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_commission">نسبة عمولة المنصة %</Label>
                <Input
                  id="svc_commission"
                  name="commission_percentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={service.commission_percentage}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_min_level">أقل مستوى فني مسموح</Label>
                <SelectNative id="svc_min_level" name="min_technician_level" defaultValue={service.min_technician_level}>
                  {Object.entries(TECHNICIAN_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_display_order">ترتيب العرض</Label>
                <Input id="svc_display_order" name="display_order" type="number" min="0" defaultValue={service.display_order} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="svc_launch_phase">مرحلة الإطلاق</Label>
                <Input id="svc_launch_phase" name="launch_phase" type="number" min="1" defaultValue={service.launch_phase} />
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
              {/* هيكل الحجز الجديد — صُنّاع (docs/06 §1) */}
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allows_individual" defaultChecked={service.allows_individual} />
                يسمح بوضع &quot;شغلانة سريعة&quot; (فرد)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="allows_team" defaultChecked={service.allows_team} />
                يسمح بوضع &quot;اعتماد&quot; (فريق/شركة)
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
              <Label htmlFor="zp_valid_from">تاريخ السريان (فاضي = فوري)</Label>
              <Input id="zp_valid_from" name="valid_from" type="date" />
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
                    <TableHead>ساري من</TableHead>
                    <TableHead>لحد</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zonePricing.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{zoneName(p.service_zone_id)}</TableCell>
                      <TableCell>{formatEgp(p.price_cents)}</TableCell>
                      <TableCell dir="ltr">{new Date(p.valid_from).toLocaleDateString('ar-EG')}</TableCell>
                      <TableCell dir="ltr">{p.valid_until ? new Date(p.valid_until).toLocaleDateString('ar-EG') : '—'}</TableCell>
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

        {/* بيانات قياسية + محرك الإنتاجية — صُنّاع (docs/06 §3.1-§3.6) */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">بيانات قياسية (أجور يومية وإنتاجية)</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowNewStandardData((s) => !s)}>
              + إضافة جديدة
            </Button>
          </CardHeader>
          <CardContent>
            {showNewStandardData && (
              <form onSubmit={handleCreateStandardData} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_execution_type">نوع التنفيذ (اختياري)</Label>
                    <Input id="sd_execution_type" name="execution_type_ar" placeholder="مثال: مباشر" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_unit">الوحدة</Label>
                    <Input id="sd_unit" name="unit_ar" placeholder="مثال: م²" required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_productivity">الإنتاجية يوميًا</Label>
                    <Input id="sd_productivity" name="productivity_per_day" type="number" min="0.01" step="0.01" required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_tech_wage">أجر الفني اليومي (جنيه)</Label>
                    <Input id="sd_tech_wage" name="technician_daily_wage" type="number" min="0" step="0.01" required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_assistant_wage">أجر المساعد اليومي (جنيه)</Label>
                    <Input id="sd_assistant_wage" name="assistant_daily_wage_cents" type="number" min="0" step="0.01" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_min_tech">أقل عدد فنيين</Label>
                    <Input id="sd_min_tech" name="min_technicians" type="number" min="1" defaultValue={1} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="sd_min_assist">أقل عدد مساعدين</Label>
                    <Input id="sd_min_assist" name="min_assistants" type="number" min="0" defaultValue={0} />
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                  حفظ البيانات القياسية
                </Button>
              </form>
            )}
            {!standardData ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : standardData.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش بيانات قياسية للخدمة دي لسه — محرك تقدير المدة مش هيشتغل من غيرها</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>نوع التنفيذ</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>الإنتاجية/يوم</TableHead>
                    <TableHead>أجر الفني</TableHead>
                    <TableHead>أجر المساعد</TableHead>
                    <TableHead>أقل طاقم</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standardData.map((row) => (
                    <Fragment key={row.id}>
                      <TableRow>
                        <TableCell>{row.execution_type_ar || '—'}</TableCell>
                        <TableCell>{row.unit_ar}</TableCell>
                        <TableCell dir="ltr">{row.productivity_per_day}</TableCell>
                        <TableCell>{formatEgp(row.technician_daily_wage_cents)}</TableCell>
                        <TableCell>{row.assistant_daily_wage_cents !== null ? formatEgp(row.assistant_daily_wage_cents) : '—'}</TableCell>
                        <TableCell dir="ltr">
                          {row.min_technicians} فني{row.min_assistants > 0 ? ` + ${row.min_assistants} مساعد` : ''}
                        </TableCell>
                        <TableCell>
                          <button type="button" disabled={isSaving} onClick={() => toggleStandardDataActive(row)} className="cursor-pointer">
                            <Badge variant={row.is_active ? 'secondary' : 'outline'}>{row.is_active ? 'نشطة' : 'معطّلة'}</Badge>
                          </button>
                        </TableCell>
                        <TableCell className="flex gap-2">
                          <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => toggleActualsForm(row.id)}>
                            الإنتاجية الفعلية
                          </Button>
                          <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => handleDeleteStandardData(row.id)}>
                            حذف
                          </Button>
                        </TableCell>
                      </TableRow>
                      {actualsFormOpenFor === row.id && (
                        <TableRow>
                          <TableCell colSpan={8}>
                            <div className="rounded-md border p-3">
                              <p className="mb-2 text-sm font-medium">
                                إنتاجية فعلية مسجّلة (مرحلة 1 — تسجيل يدوي فقط، لسه مش مربوطة تلقائيًا بالطلبات)
                              </p>
                              <form
                                onSubmit={(e) => handleRecordActual(e, row.id)}
                                className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end"
                              >
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`ra_units_${row.id}`}>الوحدات الفعلية</Label>
                                  <Input id={`ra_units_${row.id}`} name="actual_units" type="number" min="0.01" step="0.01" required />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`ra_days_${row.id}`}>الأيام الفعلية</Label>
                                  <Input id={`ra_days_${row.id}`} name="actual_days" type="number" min="0.01" step="0.01" required />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`ra_tech_${row.id}`}>عدد الفنيين</Label>
                                  <Input id={`ra_tech_${row.id}`} name="actual_technicians" type="number" min="1" defaultValue={1} required />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`ra_assist_${row.id}`}>عدد المساعدين</Label>
                                  <Input id={`ra_assist_${row.id}`} name="actual_assistants" type="number" min="0" defaultValue={0} />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`ra_notes_${row.id}`}>ملاحظات</Label>
                                  <Input id={`ra_notes_${row.id}`} name="notes" />
                                </div>
                                <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                                  تسجيل
                                </Button>
                              </form>
                              {!actualsByStandardData[row.id] ? (
                                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
                              ) : actualsByStandardData[row.id].length === 0 ? (
                                <p className="text-sm text-muted-foreground">مفيش إنتاجية فعلية متسجّلة لسه</p>
                              ) : (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>الوحدات</TableHead>
                                      <TableHead>الأيام</TableHead>
                                      <TableHead>الطاقم</TableHead>
                                      <TableHead>الإنتاجية المحسوبة/يوم</TableHead>
                                      <TableHead>ملاحظات</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {actualsByStandardData[row.id].map((a) => (
                                      <TableRow key={a.id}>
                                        <TableCell dir="ltr">{a.actual_units}</TableCell>
                                        <TableCell dir="ltr">{a.actual_days}</TableCell>
                                        <TableCell dir="ltr">
                                          {a.actual_technicians} فني{a.actual_assistants > 0 ? ` + ${a.actual_assistants} مساعد` : ''}
                                        </TableCell>
                                        <TableCell dir="ltr">{a.computed_productivity_per_day.toFixed(2)}</TableCell>
                                        <TableCell>{a.notes || '—'}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {service.pricing_model === 'formula' && (
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">محرك التسعير الديناميكي</h2>
          <PricingBuilder serviceId={id} />
        </div>
      )}
    </AppShell>
  );
}
