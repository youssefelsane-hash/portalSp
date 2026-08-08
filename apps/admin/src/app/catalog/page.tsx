'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminServiceCategoryResponseDto,
  AdminServiceResponseDto,
  CreateServiceCategoryBody,
  CreateServiceBody,
  PricingModel,
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

const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'ثابت',
  hourly: 'بالساعة',
  per_unit: 'بالوحدة',
  inspection_then_quote: 'كشف ثم عرض سعر',
};

export default function CatalogPage() {
  const { isLoading, authedFetch } = useAuth();
  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [services, setServices] = useState<AdminServiceResponseDto[] | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
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
    const body: CreateServiceCategoryBody = {
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      slug: form.get('slug') as string,
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
    const body: CreateServiceBody = {
      category_id: form.get('category_id') as string,
      name_ar: form.get('name_ar') as string,
      slug: form.get('slug') as string,
      pricing_model: form.get('pricing_model') as PricingModel,
      base_price_cents: Math.round(Number(form.get('base_price')) * 100),
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
      <h1 className="mb-6 text-xl font-semibold">الكتالوج</h1>
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
                <Button type="submit" size="sm" disabled={isSaving}>
                  حفظ الفئة
                </Button>
              </form>
            )}
            {!categories ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش فئات لسه</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((category) => (
                    <TableRow key={category.id}>
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
                    </TableRow>
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
                <Input name="name_ar" placeholder="اسم الخدمة بالعربي" required />
                <Input name="slug" placeholder="slug" required dir="ltr" />
                <Label htmlFor="service_pricing_model">نوع التسعير</Label>
                <SelectNative id="service_pricing_model" name="pricing_model" required defaultValue="fixed">
                  {Object.entries(PRICING_MODEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
                <Label htmlFor="base_price">السعر الأساسي (جنيه)</Label>
                <Input id="base_price" name="base_price" type="number" min="0" step="0.01" required />
                <Button type="submit" size="sm" disabled={isSaving}>
                  حفظ الخدمة
                </Button>
              </form>
            )}

            {!services ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : services.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش خدمات في الفئة دي</p>
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
                      <TableCell>{service.name_ar}</TableCell>
                      <TableCell>{PRICING_MODEL_LABELS[service.pricing_model]}</TableCell>
                      <TableCell>{formatEgp(service.base_price_cents)}</TableCell>
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
        دوس على شارة الحالة عشان تفعّل/تعطّل. تعديل باقي حقول الخدمة (التسعير التفصيلي، الحد
        الأدنى/الأقصى، الضمان، ...) وتسعير المناطق والفنيين المؤهلين لسه مش متاحين من هنا — فجوة موثّقة.
      </p>
    </AppShell>
  );
}
