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
  UpdateServiceCategoryBody,
} from '@baytak/shared-types';
import { CalendarClock, Camera, Siren, UserRound, UsersRound } from 'lucide-react';
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
import { CatalogConfigSection, CatalogToggle } from '@/components/catalog-config-section';

const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'ثابت',
  hourly: 'بالساعة',
  per_unit: 'بالوحدة',
  monthly: 'شهري (عدد وحدات شهرية)',
  inspection_then_quote: 'كشف ثم عرض سعر',
  // محرك التسعير الديناميكي (docs/08 §1) — بعد الاختيار، إدارة الحقول/القواعد من صفحة تفاصيل
  // الخدمة (قسم "محرك التسعير الديناميكي").
  formula: 'معادلة ديناميكية',
};

function MediaThumbnail({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return <span className="text-xs text-muted-foreground">غير مضاف</span>;
  }
  return (
    <div className="flex items-center gap-2">
      {/* روابط الوسائط يديرها الأدمن وقد تكون من أي CDN، لذلك next/image غير مناسب هنا. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="h-10 w-10 rounded-lg border bg-white object-contain p-1" />
      <span className="max-w-24 truncate text-xs text-muted-foreground" dir="ltr" title={url}>
        الرابط محفوظ
      </span>
    </div>
  );
}

// docs/08 §98 (بلاغ مالك: «الصورة بتتحط فقط أثناء إنشاء الفئة… ما بقاش فيه إمكانية إنك ترجع
// تعدل»). السبب الحقيقي: الخانتين كانوا **روابط نصية بس** ومفيش أي مكان في المنصة يرفع صورة فئة،
// فالأدمن عمليًا مقدرش يغيّرها بعد أول مرة. الرفع الفعلي + المسح هما اللي بيقفلوا الفجوة.
function CategoryMediaManager({ category, onChanged }: { category: AdminServiceCategoryResponseDto; onChanged: () => void }) {
  const { authedFetch } = useAuth();
  const [busySlot, setBusySlot] = useState<'icon' | 'cover' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(slot: 'icon' | 'cover', file: File) {
    setBusySlot(slot);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      await authedFetch(`/admin/service-categories/${category.id}/media/${slot}`, { method: 'POST', body });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مقدرناش نرفع الصورة، حاول تاني');
    } finally {
      setBusySlot(null);
    }
  }

  async function clear(slot: 'icon' | 'cover') {
    setBusySlot(slot);
    setError(null);
    try {
      await authedFetch(`/admin/service-categories/${category.id}/media/${slot}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'مقدرناش نمسح الصورة، حاول تاني');
    } finally {
      setBusySlot(null);
    }
  }

  const slots: {
    slot: 'icon' | 'cover';
    label: string;
    hint: string;
    url: string | null;
  }[] = [
    {
      slot: 'icon',
      label: 'الأيقونة الصغيرة',
      hint: 'بتظهر جنب اسم الفئة.',
      url: category.icon_url,
    },
    {
      slot: 'cover',
      label: 'صورة الغلاف',
      hint: 'بتظهر كصورة كبيرة في كارت الفئة.',
      url: category.cover_image_url,
    },
  ];

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-1 text-sm font-semibold">صور الفئة</p>
      <p className="mb-3 text-xs text-muted-foreground">PNG / JPEG / WEBP بس (مفيش SVG)، لحد 5 ميجا. التغيير بيتحفظ فورًا وبيظهر في التطبيقات على طول.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {slots.map(({ slot, label, hint, url }) => (
          <div key={slot} className="flex flex-col gap-2 rounded-md border bg-background p-3">
            <Label>{label}</Label>
            <MediaThumbnail url={url} label={`${label} ${category.name_ar}`} />
            <p className="text-xs text-muted-foreground">{hint}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busySlot !== null}
                className="max-w-56"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // بنفضّي الخانة بعد الرفع عشان اختيار **نفس** الملف تاني (بعد فشل مثلاً) يشغّل
                  // onChange تاني — من غير كده المتصفح بيعتبرها "مفيش تغيير" ومايناديش.
                  e.target.value = '';
                  if (file) void upload(slot, file);
                }}
              />
              {url && (
                <Button type="button" size="sm" variant="ghost" disabled={busySlot !== null} onClick={() => void clear(slot)}>
                  مسح
                </Button>
              )}
              {busySlot === slot && <span className="text-xs text-muted-foreground">جاري الحفظ…</span>}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

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
      await authedFetch('/admin/service-categories', {
        method: 'POST',
        body: JSON.stringify(body),
      });
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
    const body: UpdateServiceCategoryBody = {
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      slug: form.get('slug') as string,
      description_ar: (form.get('description_ar') as string) || undefined,
      // الصور **مش** هنا عمدًا (docs/08 §98): بتتحفظ لحظيًا من CategoryMediaManager. لو فضلت في
      // الـPATCH ده، أي حفظ للاسم كان هيبعت الروابط القديمة اللي في الفورم ويدوس على صورة
      // اتغيّرت لسه من فوق — بَقّة "الصورة رجعت زي ما كانت" الكلاسيكية.
      parent_category_id: parentCategoryId || undefined,
      display_order: displayOrder ? Number(displayOrder) : undefined,
      launch_phase: launchPhase ? Number(launchPhase) : undefined,
      is_featured: form.get('is_featured') === 'on',
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/service-categories/${categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
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
    const displayOrder = form.get('display_order') as string;
    const launchPhase = form.get('launch_phase') as string;
    const minTechnicianLevel = form.get('min_technician_level') as string;
    const quantityMin = form.get('quantity_min') as string;
    const quantityMax = form.get('quantity_max') as string;
    const quantityStep = form.get('quantity_step') as string;
    const body: CreateServiceBody = {
      category_id: form.get('category_id') as string,
      name_ar: form.get('name_ar') as string,
      name_en: (form.get('name_en') as string) || undefined,
      slug: form.get('slug') as string,
      short_description_ar: (form.get('short_description_ar') as string) || undefined,
      full_description_ar: (form.get('full_description_ar') as string) || undefined,
      icon_url: (form.get('icon_url') as string) || undefined,
      featured_icon_url: (form.get('featured_icon_url') as string) || undefined,
      featured_name_ar: (form.get('featured_name_ar') as string) || undefined,
      pricing_model: form.get('pricing_model') as PricingModel,
      base_price_cents: Math.round(Number(form.get('base_price')) * 100),
      inspection_fee_cents: inspectionFee ? Math.round(Number(inspectionFee) * 100) : undefined,
      unit_name_ar: (form.get('unit_name_ar') as string) || undefined,
      quantity_min: quantityMin ? Number(quantityMin) : undefined,
      quantity_max: quantityMax ? Number(quantityMax) : undefined,
      quantity_step: quantityStep ? Number(quantityStep) : undefined,
      quantity_precision: Number(form.get('quantity_precision')),
      estimated_duration_minutes: estimatedDuration ? Number(estimatedDuration) : undefined,
      warranty_days: Number(form.get('warranty_days')) || undefined,
      requires_photos: form.get('requires_photos') === 'on',
      allows_scheduling: form.get('allows_scheduling') === 'on',
      allows_emergency: form.get('allows_emergency') === 'on',
      allows_individual: form.get('allows_individual') === 'on',
      allows_team: form.get('allows_team') === 'on',
      min_technician_level: (minTechnicianLevel as TechnicianLevel) || undefined,
      display_order: displayOrder ? Number(displayOrder) : undefined,
      launch_phase: launchPhase ? Number(launchPhase) : undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/services', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setShowNewService(false);
      loadServices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  /** بوابة الإعلان التلقائي (ADR-0046) — منفصلة تمامًا عن التفعيل: خدمة نشطة للحجز مش
   *  بالضرورة جاهزة إن المنصة تعلن عنها لوحدها. */
  async function toggleServicePromotable(service: AdminServiceResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_promotable: !service.is_promotable }),
      });
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
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-3 text-sm font-semibold">وسائط الفئة</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_cat_icon">رابط الأيقونة الصغيرة</Label>
                      <Input id="new_cat_icon" name="icon_url" placeholder="https://.../icon.png" dir="ltr" />
                      <p className="text-xs text-muted-foreground">تظهر بجوار اسم الفئة.</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_cat_cover">رابط صورة غلاف الفئة</Label>
                      <Input id="new_cat_cover" name="cover_image_url" placeholder="https://.../cover.jpg" dir="ltr" />
                      <p className="text-xs text-muted-foreground">تظهر كصورة كبيرة في كارت الفئة.</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    معندكش رابط؟ احفظ الفئة الأول، وبعدين من «تعديل» ارفع الصورتين من جهازك مباشرة — وتقدر تغيّرهم أو تمسحهم في أي وقت بعد كده.
                  </p>
                </div>
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
                    <TableHead>الوسائط</TableHead>
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
                          <div className="flex gap-3">
                            <MediaThumbnail url={category.icon_url} label={`أيقونة ${category.name_ar}`} />
                            <MediaThumbnail url={category.cover_image_url} label={`غلاف ${category.name_ar}`} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <button type="button" disabled={isSaving} onClick={() => toggleCategoryActive(category)} className="cursor-pointer">
                            <Badge variant={category.is_active ? 'secondary' : 'outline'}>{category.is_active ? 'نشطة' : 'معطّلة'}</Badge>
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
                          <TableCell colSpan={5}>
                            <form
                              onSubmit={(e) => handleUpdateCategory(e, category.id)}
                              className="flex flex-col gap-5 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.045] via-background to-background p-4 shadow-sm"
                            >
                              <div>
                                <h3 className="font-semibold">تعديل فئة «{category.name_ar}»</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  الاسم والترتيب يتحفظوا من الزر بالأسفل، والصور يمكن استبدالها في أي وقت من قسم الوسائط.
                                </p>
                              </div>
                              <div className="grid gap-3 md:grid-cols-3">
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`category-name-ar-${category.id}`}>الاسم بالعربي</Label>
                                  <Input id={`category-name-ar-${category.id}`} name="name_ar" defaultValue={category.name_ar} required />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`category-name-en-${category.id}`}>الاسم بالإنجليزي</Label>
                                  <Input id={`category-name-en-${category.id}`} name="name_en" defaultValue={category.name_en} dir="ltr" required />
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label htmlFor={`category-slug-${category.id}`}>الرابط المختصر (Slug)</Label>
                                  <Input id={`category-slug-${category.id}`} name="slug" defaultValue={category.slug} dir="ltr" required />
                                </div>
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`category-description-${category.id}`}>وصف الفئة</Label>
                                <Textarea id={`category-description-${category.id}`} name="description_ar" defaultValue={category.description_ar ?? ''} rows={2} />
                              </div>
                              {/* الصور بتتحفظ لحظيًا بنفسها (رفع/مسح مستقل عن زرار "حفظ التعديلات")
                                  — الرفع عملية ملف مش حقل نصي، فمينفعش يستنى submit الفورم. */}
                              <CategoryMediaManager category={category} onChanged={loadCategories} />
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
                              <div className="flex flex-wrap gap-2">
                                <Button type="submit" size="sm" disabled={isSaving}>
                                  حفظ تعديلات الفئة
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingCategoryId(null)}>
                                  إلغاء
                                </Button>
                              </div>
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
                <div className="grid gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_service_icon">صورة صفحة الخدمة</Label>
                    <Input id="new_service_icon" name="icon_url" placeholder="https://.../service-banner.jpg" dir="ltr" />
                    <p className="text-xs text-muted-foreground">صورة كبيرة تناسب تفاصيل الخدمة والكتالوج.</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_service_featured_icon">شعار الأكثر طلبًا</Label>
                    <Input id="new_service_featured_icon" name="featured_icon_url" placeholder="https://.../small-logo.png" dir="ltr" />
                    <p className="text-xs text-muted-foreground">شعار صغير مستقل، ويفضل مربعًا أو بخلفية شفافة.</p>
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <Label htmlFor="new_service_featured_name">الاسم المختصر في الأكثر طلبًا</Label>
                    <Input id="new_service_featured_name" name="featured_name_ar" maxLength={60} placeholder="مثال: تركيب سخان" />
                    <p className="text-xs text-muted-foreground">اسم خاطف فقط؛ لو تركته فارغًا سيظهر اسم الخدمة الأساسي.</p>
                  </div>
                </div>
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
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="mb-3 text-sm font-medium">ضوابط الكمية للخدمات بالوحدة أو بالشهر</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_svc_quantity_min">أقل كمية</Label>
                      <Input id="new_svc_quantity_min" name="quantity_min" type="number" min="0.01" step="0.01" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_svc_quantity_max">أكبر كمية</Label>
                      <Input id="new_svc_quantity_max" name="quantity_max" type="number" min="0.01" step="0.01" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_svc_quantity_step">خطوة الزيادة</Label>
                      <Input id="new_svc_quantity_step" name="quantity_step" type="number" min="0.01" step="0.01" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="new_svc_quantity_precision">الأرقام بعد العلامة</Label>
                      <SelectNative id="new_svc_quantity_precision" name="quantity_precision" defaultValue="2">
                        <option value="0">بدون كسور</option>
                        <option value="1">رقم واحد</option>
                        <option value="2">رقمان</option>
                      </SelectNative>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="new_svc_warranty">أيام الضمان</Label>
                    <Input id="new_svc_warranty" name="warranty_days" type="number" min={0} defaultValue={0} dir="ltr" />
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    عمولة المنصة الثابتة تتحدد بعد إنشاء الخدمة من مركز سياسة المستحقات.
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
                <CatalogConfigSection
                  title="إعدادات الحجز عند الإنشاء"
                  description="حدد طرق تقديم الخدمة الآن، ويمكن تعديل كل اختيار لاحقًا من صفحة تفاصيل الخدمة."
                  icon={CalendarClock}
                  tone="blue"
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <CatalogToggle
                      name="requires_photos"
                      title="صور قبل وبعد"
                      description="يطلب من الفني توثيق حالة الشغل بالصور."
                      icon={Camera}
                    />
                    <CatalogToggle
                      name="allows_scheduling"
                      title="حجز مجدول"
                      description="يسمح للعميل باختيار موعد مسبق للخدمة."
                      icon={CalendarClock}
                      defaultChecked
                    />
                    <CatalogToggle name="allows_emergency" title="طلب طارئ" description="يظهر وضع الوصول العاجل لهذه الخدمة." icon={Siren} />
                    <CatalogToggle
                      name="allows_individual"
                      title="شغلانة سريعة"
                      description="تنفيذ فردي لفني واحد، مع مساعد اختياري عند الحاجة."
                      icon={UserRound}
                      defaultChecked
                    />
                    <CatalogToggle
                      name="allows_team"
                      title="اعتماد فريق أو شركة"
                      description="للأعمال الكبيرة التي تحتاج أكثر من فرد."
                      icon={UsersRound}
                    />
                  </div>
                </CatalogConfigSection>
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
                    <TableHead>صورة الخدمة</TableHead>
                    <TableHead>الأكثر طلبًا</TableHead>
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
                      <TableCell>
                        <MediaThumbnail url={service.icon_url} label={`أيقونة ${service.name_ar}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <MediaThumbnail url={service.featured_icon_url} label={`شعار ${service.featured_name_ar ?? service.name_ar}`} />
                          <span className="text-xs text-muted-foreground">{service.featured_name_ar || service.name_ar}</span>
                        </div>
                      </TableCell>
                      <TableCell>{PRICING_MODEL_LABELS[service.pricing_model]}</TableCell>
                      <TableCell>{service.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(service.base_price_cents)}</TableCell>
                      <TableCell>
                        <button type="button" disabled={isSaving} onClick={() => toggleServiceActive(service)} className="cursor-pointer">
                          <Badge variant={service.is_active ? 'secondary' : 'outline'}>{service.is_active ? 'نشطة' : 'معطّلة'}</Badge>
                        </button>
                        {/* ADR-0046 — الخدمة ما بتتعلنش تلقائيًا إلا لو الأدمن علّمها هنا. */}
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => toggleServicePromotable(service)}
                          className="mr-2 cursor-pointer"
                          title="السماح للمنصة تبعت إشعارات إعلانية عن الخدمة دي"
                        >
                          <Badge variant={service.is_promotable ? 'secondary' : 'outline'}>{service.is_promotable ? 'قابلة للإعلان' : 'مش بتتعلن'}</Badge>
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
        دوس على شارة الحالة عشان تفعّل/تعطّل، وعلى شارة «قابلة للإعلان» عشان تسمح للمنصة تبعت إشعارات إعلانية عن الخدمة دي (الحملات التسويقية). دوس على اسم
        الخدمة عشان تعدّل كل حقول الخدمة التفصيلية (السعر الأساسي، الحد الأدنى/الأقصى، الضمان، أقل مستوى فني، ...) وتدير تسعير المناطق، فئات تسعير الفني، تسعير
        المستويات، والإضافات الاختيارية.
      </p>
    </AppShell>
  );
}
