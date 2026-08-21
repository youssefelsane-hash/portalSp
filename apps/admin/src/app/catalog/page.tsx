'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type {
  AdminServiceCategoryResponseDto,
  AdminServiceResponseDto,
  CreateServiceCategoryBody,
  CreateServiceBody,
  PricingModel,
  TechnicianLevel,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LEVEL_LABELS } from '@/lib/technician-labels';
import { formatEgp } from '@/lib/format';

const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'ثابت',
  hourly: 'بالساعة',
  per_unit: 'بالوحدة',
  inspection_then_quote: 'كشف ثم عرض سعر',
  // محرك التسعير الديناميكي (docs/08 §1) — بعد الاختيار، إدارة الحقول/القواعد من صفحة تفاصيل
  // الخدمة (قسم "محرك التسعير الديناميكي").
  formula: 'معادلة ديناميكية',
};

export default function CatalogPage() {
  const { isLoading, authedFetch } = useAuth();
  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [services, setServices] = useState<AdminServiceResponseDto[] | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [showNewService, setShowNewService] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function loadCategories() {
    authedFetch<AdminServiceCategoryResponseDto[]>('/admin/service-categories')
      .then(setCategories)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفئات'));
  }

  function loadServices() {
    const query = selectedCategoryId !== 'all' ? `?category_id=${selectedCategoryId}` : '';
    authedFetch<AdminServiceResponseDto[]>(`/admin/services${query}`)
      .then(setServices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الخدمات'));
  }

  useEffect(() => {
    if (isLoading) return;
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) return;
    loadServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, selectedCategoryId]);

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const parentCategoryId = form.get('parent_category_id') as string;
    const displayOrder = form.get('display_order') as string;
    const launchPhase = form.get('launch_phase') as string;
    const body: CreateServiceCategoryBody = {
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      slug: form.get('slug') as string,
      parent_category_id: parentCategoryId || undefined,
      description_ar: (form.get('description_ar') as string) || undefined,
      icon_url: (form.get('icon_url') as string) || undefined,
      cover_image_url: (form.get('cover_image_url') as string) || undefined,
      display_order: displayOrder ? Number(displayOrder) : undefined,
      launch_phase: launchPhase ? Number(launchPhase) : undefined,
      is_featured: form.get('is_featured') === 'on',
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/service-categories', { method: 'POST', body: JSON.stringify(body) });
      setShowNewCategory(false);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // كانت فجوة موثّقة صراحة: الفئات مكانش ليها تعديل غير تفعيل/تعطيل — إعادة تسمية، تغيير الأب،
  // الأيقونة، الترتيب، أو Featured كان لازم SQL مباشر، رغم إن الباك-إند بيدعمهم كلهم من زمان.
  async function handleUpdateCategory(e: FormEvent, categoryId: string) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const parentCategoryId = form.get('parent_category_id') as string;
    const displayOrder = form.get('display_order') as string;
    const launchPhase = form.get('launch_phase') as string;
    const body = {
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      description_ar: (form.get('description_ar') as string) || undefined,
      icon_url: (form.get('icon_url') as string) || undefined,
      cover_image_url: (form.get('cover_image_url') as string) || undefined,
      parent_category_id: parentCategoryId || undefined,
      display_order: displayOrder ? Number(displayOrder) : undefined,
      launch_phase: launchPhase ? Number(launchPhase) : undefined,
      is_featured: form.get('is_featured') === 'on',
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/service-categories/${categoryId}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditingCategoryId(null);
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleCategoryActive(category: AdminServiceCategoryResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/service-categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !category.is_active }),
      });
      loadCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateService(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const inspectionFee = form.get('inspection_fee') as string;
    const estimatedDuration = form.get('estimated_duration_minutes') as string;
    const commission = form.get('commission_percentage') as string;
    const displayOrder = form.get('display_order') as string;
    const launchPhase = form.get('launch_phase') as string;
    const minTechnicianLevel = form.get('min_technician_level') as string;
    const body: CreateServiceBody = {
      category_id: form.get('category_id') as string,
      name_ar: form.get('name_ar') as string,
      name_en: (form.get('name_en') as string) || undefined,
      slug: form.get('slug') as string,
      short_description_ar: (form.get('short_description_ar') as string) || undefined,
      full_description_ar: (form.get('full_description_ar') as string) || undefined,
      icon_url: (form.get('icon_url') as string) || undefined,
      pricing_model: form.get('pricing_model') as PricingModel,
      base_price_cents: Math.round(Number(form.get('base_price')) * 100),
      inspection_fee_cents: inspectionFee ? Math.round(Number(inspectionFee) * 100) : undefined,
      unit_name_ar: (form.get('unit_name_ar') as string) || undefined,
      estimated_duration_minutes: estimatedDuration ? Number(estimatedDuration) : undefined,
      warranty_days: Number(form.get('warranty_days')) || undefined,
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
      await authedFetch('/admin/services', { method: 'POST', body: JSON.stringify(body) });
      setShowNewService(false);
      loadServices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleServiceActive(service: AdminServiceResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !service.is_active }),
      });
      loadServices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="الكتالوج" />
      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">الفئات</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowNewCategory((s) => !s)}>
              + فئة جديدة
            </Button>
          </CardHeader>
          <CardContent>
            {showNewCategory && (
              <form onSubmit={handleCreateCategory} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                <Input name="name_ar" placeholder="الاسم بالعربي" required />
                <Input name="name_en" placeholder="الاسم بالإنجليزي" required />
                <Input name="slug" placeholder="slug (مثال: plumbing)" required dir="ltr" />
                <Textarea name="description_ar" placeholder="وصف الفئة (اختياري)" rows={2} />
                <Input name="icon_url" placeholder="رابط الأيقونة (اختياري)" dir="ltr" />
                {/* Script 6 Part 1-2 — صورة غلاف الكارت (تعرض في التطبيق بنسبة عرض 4:3، مختلفة
                    عن الأيقونة الصغيرة icon_url). */}
                <Input name="cover_image_url" placeholder="رابط صورة الغلاف (اختياري — بتظهر في كارت الفئة بالتطبيق)" dir="ltr" />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new_cat_parent">فئة أب (اختياري — لعمل فئة فرعية)</Label>
                  <SelectNative id="new_cat_parent" name="parent_category_id" defaultValue="">
                    <option value="">— بلا (فئة رئيسية) —</option>
                    {categories?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_ar}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_cat_order">ترتيب العرض</Label>
                    <Input id="new_cat_order" name="display_order" type="number" min={0} dir="ltr" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_cat_phase">مرحلة الإطلاق</Label>
                    <Input id="new_cat_phase" name="launch_phase" type="number" min={1} dir="ltr" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_featured" />
                  فئة مميّزة (Featured)
                </label>
                <Button type="submit" size="sm" disabled={isSaving}>
                  حفظ الفئة
                </Button>
              </form>
            )}
            {!categories ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : categories.length === 0 ? (
              <EmptyState title="مفيش فئات لسه" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((category) => (
                    <Fragment key={category.id}>
                      <TableRow>
                        <TableCell>{category.name_ar}</TableCell>
                        <TableCell dir="ltr">{category.slug}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => toggleCategoryActive(category)}
                            className="cursor-pointer"
                          >
                            <Badge variant={category.is_active ? 'secondary' : 'outline'}>
                              {category.is_active ? 'نشطة' : 'معطّلة'}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingCategoryId((id) => (id === category.id ? null : category.id))}
                          >
                            تعديل
                          </Button>
                        </TableCell>
                      </TableRow>
                      {editingCategoryId === category.id && (
                        <TableRow key={`${category.id}-edit`}>
                          <TableCell colSpan={4}>
                            <form
                              onSubmit={(e) => handleUpdateCategory(e, category.id)}
                              className="flex flex-col gap-2 rounded-md border p-3"
                            >
                              <div className="grid grid-cols-2 gap-2">
                                <Input name="name_ar" defaultValue={category.name_ar} placeholder="الاسم بالعربي" required />
                                <Input name="name_en" defaultValue={category.name_en} placeholder="الاسم بالإنجليزي" required />
                              </div>
                              <Textarea name="description_ar" defaultValue={category.description_ar ?? ''} placeholder="الوصف" rows={2} />
                              <Input name="icon_url" defaultValue={category.icon_url ?? ''} placeholder="رابط الأيقونة" dir="ltr" />
                              <Input
                                name="cover_image_url"
                                defaultValue={category.cover_image_url ?? ''}
                                placeholder="رابط صورة الغلاف (بتظهر في كارت الفئة بالتطبيق)"
                                dir="ltr"
                              />
                              <div className="flex flex-col gap-1">
                                <Label>فئة أب</Label>
                                <SelectNative name="parent_category_id" defaultValue={category.parent_category_id ?? ''}>
                                  <option value="">— بلا (فئة رئيسية) —</option>
                                  {categories
                                    .filter((c) => c.id !== category.id)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name_ar}
                                      </option>
                                    ))}
                                </SelectNative>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                  <Label>ترتيب العرض</Label>
                                  <Input name="display_order" type="number" min={0} defaultValue={category.display_order} dir="ltr" />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label>مرحلة الإطلاق</Label>
                                  <Input name="launch_phase" type="number" min={1} defaultValue={category.launch_phase} dir="ltr" />
                                </div>
                              </div>
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="is_featured" defaultChecked={category.is_featured} />
                                فئة مميّزة (Featured)
                              </label>
                              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                                حفظ التعديلات
                              </Button>
                            </form>
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

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">الخدمات</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowNewService((s) => !s)}>
              + خدمة جديدة
            </Button>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <SelectNative value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
                <option value="all">كل الفئات</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </SelectNative>
            </div>

            {showNewService && (
              <form onSubmit={handleCreateService} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                <Label htmlFor="service_category_id">الفئة</Label>
                <SelectNative id="service_category_id" name="category_id" required defaultValue="">
                  <option value="" disabled>
                    اختار فئة
                  </option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_ar}
                    </option>
                  ))}
                </SelectNative>
                <div className="grid grid-cols-2 gap-2">
                  <Input name="name_ar" placeholder="اسم الخدمة بالعربي" required />
                  <Input name="name_en" placeholder="اسم الخدمة بالإنجليزي" dir="ltr" />
                </div>
                <Input name="slug" placeholder="slug" required dir="ltr" />
                <Input name="short_description_ar" placeholder="وصف مختصر (اختياري)" />
                <Textarea name="full_description_ar" placeholder="وصف كامل (اختياري)" rows={2} />
                <Input name="icon_url" placeholder="رابط الأيقونة (اختياري)" dir="ltr" />
                <Label htmlFor="service_pricing_model">نوع التسعير</Label>
                <SelectNative id="service_pricing_model" name="pricing_model" required defaultValue="fixed">
                  {Object.entries(PRICING_MODEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="base_price">السعر الأساسي (جنيه)</Label>
                    <Input id="base_price" name="base_price" type="number" min="0" step="0.01" required />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_inspection_fee">رسوم الكشف (جنيه)</Label>
                    <Input id="new_svc_inspection_fee" name="inspection_fee" type="number" min="0" step="0.01" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_unit">اسم الوحدة (مثال: متر مربع)</Label>
                    <Input id="new_svc_unit" name="unit_name_ar" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_duration">المدة المتوقعة (دقيقة)</Label>
                    <Input id="new_svc_duration" name="estimated_duration_minutes" type="number" min={1} dir="ltr" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_warranty">أيام الضمان</Label>
                    <Input id="new_svc_warranty" name="warranty_days" type="number" min={0} defaultValue={0} dir="ltr" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_commission">نسبة عمولة المنصة %</Label>
                    <Input id="new_svc_commission" name="commission_percentage" type="number" min={0} max={100} step="0.01" dir="ltr" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_min_level">أقل مستوى فني مسموح</Label>
                    <SelectNative id="new_svc_min_level" name="min_technician_level" defaultValue="">
                      <option value="">— أي مستوى —</option>
                      {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </SelectNative>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_order">ترتيب العرض</Label>
                    <Input id="new_svc_order" name="display_order" type="number" min={0} dir="ltr" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new_svc_phase">مرحلة الإطلاق</Label>
                  <Input id="new_svc_phase" name="launch_phase" type="number" min={1} className="max-w-[8rem]" dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="requires_photos" />
                    محتاجة صور قبل/بعد
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allows_scheduling" defaultChecked />
                    بتسمح بجدولة
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allows_emergency" />
                    بتسمح بطوارئ
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allows_individual" defaultChecked />
                    وضع أفراد
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allows_team" />
                    وضع اعتماد (فريق/شركة)
                  </label>
                </div>
                <Button type="submit" size="sm" disabled={isSaving}>
                  حفظ الخدمة
                </Button>
              </form>
            )}

            {!services ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : services.length === 0 ? (
              <EmptyState title="مفيش خدمات في الفئة دي" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>التسعير</TableHead>
                    <TableHead>السعر الأساسي</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>
                        <Link href={`/catalog/services/${service.id}`} className="hover:underline">
                          {service.name_ar}
                        </Link>
                      </TableCell>
                      <TableCell>{PRICING_MODEL_LABELS[service.pricing_model]}</TableCell>
                      <TableCell>
                        {service.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(service.base_price_cents)}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => toggleServiceActive(service)}
                          className="cursor-pointer"
                        >
                          <Badge variant={service.is_active ? 'secondary' : 'outline'}>
                            {service.is_active ? 'نشطة' : 'معطّلة'}
                          </Badge>
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

      <p className="mt-6 text-sm text-muted-foreground">
        دوس على شارة الحالة عشان تفعّل/تعطّل. دوس على اسم الخدمة عشان تعدّل كل حقول الخدمة
        التفصيلية (السعر الأساسي، الحد الأدنى/الأقصى، الضمان، أقل مستوى فني، ...) وتدير تسعير
        المناطق، فئات تسعير الفني، تسعير المستويات، والإضافات الاختيارية.
      </p>
    </AppShell>
  );
}
