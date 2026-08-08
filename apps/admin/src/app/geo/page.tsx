'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminAreaResponseDto,
  AdminCityResponseDto,
  AdminCountryResponseDto,
  AdminServiceZoneResponseDto,
  CreateAreaBody,
  CreateCityBody,
  CreateServiceZoneBody,
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

export default function GeoPage() {
  const { isLoading, authedFetch } = useAuth();
  const [countries, setCountries] = useState<AdminCountryResponseDto[] | null>(null);
  const [cities, setCities] = useState<AdminCityResponseDto[] | null>(null);
  const [areas, setAreas] = useState<AdminAreaResponseDto[] | null>(null);
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewCity, setShowNewCity] = useState(false);
  const [showNewArea, setShowNewArea] = useState(false);
  const [showNewZone, setShowNewZone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function loadCountries() {
    authedFetch<AdminCountryResponseDto[]>('/admin/countries')
      .then(setCountries)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الدول'));
  }

  function loadCities() {
    authedFetch<AdminCityResponseDto[]>('/admin/cities')
      .then((data) => {
        setCities(data);
        if (!selectedCityId && data.length > 0) setSelectedCityId(data[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المدن'));
  }

  function loadAreas(cityId: string) {
    authedFetch<AdminAreaResponseDto[]>(`/admin/areas?city_id=${cityId}`)
      .then(setAreas)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المناطق'));
  }

  function loadZones(cityId: string) {
    authedFetch<AdminServiceZoneResponseDto[]>(`/admin/service-zones?city_id=${cityId}`)
      .then(setZones)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل نطاقات الخدمة'));
  }

  useEffect(() => {
    if (isLoading) return;
    loadCountries();
    loadCities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || !selectedCityId) return;
    loadAreas(selectedCityId);
    loadZones(selectedCityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, selectedCityId]);

  async function handleCreateCity(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const lat = form.get('latitude') as string;
    const lng = form.get('longitude') as string;
    const body: CreateCityBody = {
      country_id: form.get('country_id') as string,
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      slug: form.get('slug') as string,
      latitude: lat ? Number(lat) : undefined,
      longitude: lng ? Number(lng) : undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      const created = await authedFetch<AdminCityResponseDto>('/admin/cities', { method: 'POST', body: JSON.stringify(body) });
      setShowNewCity(false);
      loadCities();
      setSelectedCityId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleCityActive(city: AdminCityResponseDto) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/cities/${city.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !city.is_active }) });
      loadCities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateArea(e: FormEvent) {
    e.preventDefault();
    if (!selectedCityId) return;
    const form = new FormData(e.target as HTMLFormElement);
    const lat = form.get('latitude') as string;
    const lng = form.get('longitude') as string;
    const body: CreateAreaBody = {
      city_id: selectedCityId,
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      slug: form.get('slug') as string,
      latitude: lat ? Number(lat) : undefined,
      longitude: lng ? Number(lng) : undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/areas', { method: 'POST', body: JSON.stringify(body) });
      setShowNewArea(false);
      loadAreas(selectedCityId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleAreaLaunched(area: AdminAreaResponseDto) {
    if (!selectedCityId) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/areas/${area.id}`, { method: 'PATCH', body: JSON.stringify({ is_launched: !area.is_launched }) });
      loadAreas(selectedCityId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateZone(e: FormEvent) {
    e.preventDefault();
    if (!selectedCityId) return;
    const form = new FormData(e.target as HTMLFormElement);
    const surge = form.get('surge_multiplier') as string;
    const body: CreateServiceZoneBody = {
      city_id: selectedCityId,
      name_ar: form.get('name_ar') as string,
      name_en: form.get('name_en') as string,
      surge_multiplier: surge ? Number(surge) : undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/service-zones', { method: 'POST', body: JSON.stringify(body) });
      setShowNewZone(false);
      loadZones(selectedCityId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleZoneActive(zone: AdminServiceZoneResponseDto) {
    if (!selectedCityId) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/service-zones/${zone.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !zone.is_active }) });
      loadZones(selectedCityId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-xl font-semibold">المدن والمناطق ونطاقات الخدمة</h1>
      {error && <p className="mb-4 text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">المدن</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowNewCity((s) => !s)}>
            + مدينة جديدة
          </Button>
        </CardHeader>
        <CardContent>
          {showNewCity && (
            <form onSubmit={handleCreateCity} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="city_country_id">الدولة</Label>
              <SelectNative id="city_country_id" name="country_id" required defaultValue="">
                <option value="" disabled>
                  اختار دولة
                </option>
                {countries?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </SelectNative>
              <Input name="name_ar" placeholder="اسم المدينة بالعربي" required />
              <Input name="name_en" placeholder="اسم المدينة بالإنجليزي" required />
              <Input name="slug" placeholder="slug (مثال: cairo)" required dir="ltr" />
              <div className="flex gap-2">
                <Input name="latitude" type="number" step="0.0001" placeholder="خط العرض (latitude، اختياري)" dir="ltr" />
                <Input name="longitude" type="number" step="0.0001" placeholder="خط الطول (longitude، اختياري)" dir="ltr" />
              </div>
              <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                حفظ المدينة
              </Button>
            </form>
          )}
          {!cities ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : cities.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش مدن لسه</p>
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
                {cities.map((city) => (
                  <TableRow
                    key={city.id}
                    className={city.id === selectedCityId ? 'bg-accent/50 cursor-pointer' : 'cursor-pointer'}
                    onClick={() => setSelectedCityId(city.id)}
                  >
                    <TableCell>{city.name_ar}</TableCell>
                    <TableCell dir="ltr">{city.slug}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCityActive(city);
                        }}
                        className="cursor-pointer"
                      >
                        <Badge variant={city.is_active ? 'secondary' : 'outline'}>
                          {city.is_active ? 'نشطة' : 'معطّلة'}
                        </Badge>
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">دوس على أي صف عشان تشوف مناطقه ونطاقات خدمته تحت.</p>
        </CardContent>
      </Card>

      {selectedCityId && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">المناطق</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowNewArea((s) => !s)}>
                + منطقة جديدة
              </Button>
            </CardHeader>
            <CardContent>
              {showNewArea && (
                <form onSubmit={handleCreateArea} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                  <Input name="name_ar" placeholder="اسم المنطقة بالعربي" required />
                  <Input name="name_en" placeholder="اسم المنطقة بالإنجليزي" required />
                  <Input name="slug" placeholder="slug" required dir="ltr" />
                  <div className="flex gap-2">
                    <Input name="latitude" type="number" step="0.0001" placeholder="خط العرض (اختياري)" dir="ltr" />
                    <Input name="longitude" type="number" step="0.0001" placeholder="خط الطول (اختياري)" dir="ltr" />
                  </div>
                  <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                    حفظ المنطقة
                  </Button>
                </form>
              )}
              {!areas ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : areas.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش مناطق للمدينة دي لسه</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>مُطلَقة؟</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {areas.map((area) => (
                      <TableRow key={area.id}>
                        <TableCell>{area.name_ar}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => toggleAreaLaunched(area)}
                            className="cursor-pointer"
                          >
                            <Badge variant={area.is_launched ? 'secondary' : 'outline'}>
                              {area.is_launched ? 'مُطلَقة' : 'لسه لأ'}
                            </Badge>
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                "مُطلَقة" (`is_launched`) بيحدد ظهور المنطقة في `GET /cities/:id/areas` العام —
                منطقة اتعملت بس لسه معطّلة الإطلاق مش هتظهر للعميل وقت اختيار العنوان.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">نطاقات الخدمة</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowNewZone((s) => !s)}>
                + نطاق جديد
              </Button>
            </CardHeader>
            <CardContent>
              {showNewZone && (
                <form onSubmit={handleCreateZone} className="mb-4 flex flex-col gap-2 rounded-md border p-3">
                  <Input name="name_ar" placeholder="اسم النطاق بالعربي" required />
                  <Input name="name_en" placeholder="اسم النطاق بالإنجليزي" required />
                  <Label htmlFor="zone_surge">مضاعف الذروة (surge، افتراضي 1)</Label>
                  <Input id="zone_surge" name="surge_multiplier" type="number" step="0.1" min="0.1" max="10" dir="ltr" />
                  <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                    حفظ النطاق
                  </Button>
                </form>
              )}
              {!zones ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : zones.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش نطاقات خدمة للمدينة دي لسه</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>مضاعف الذروة</TableHead>
                      <TableHead>مضلّع مرسوم؟</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.map((zone) => (
                      <TableRow key={zone.id}>
                        <TableCell>{zone.name_ar}</TableCell>
                        <TableCell dir="ltr">{zone.surge_multiplier}×</TableCell>
                        <TableCell>{zone.has_boundary ? 'مرسوم' : '—'}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => toggleZoneActive(zone)}
                            className="cursor-pointer"
                          >
                            <Badge variant={zone.is_active ? 'secondary' : 'outline'}>
                              {zone.is_active ? 'نشط' : 'معطّل'}
                            </Badge>
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                رسم مضلّع تغطية النطاق (`PUT /admin/service-zones/:id/boundary`) لسه محتاج
                إحداثيات خام عبر الـ API — مفيش لوحة رسم خرائط تفاعلية هنا، فجوة موثّقة.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
