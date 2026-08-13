'use client';

// نقطة دخول مركزية لمحرك التسعير الديناميكي (docs/08 §1، ADR-0001) — كانت فجوة اكتشافية حقيقية:
// المحرك (حقول/قواعد/معادلة/معاينة، pricing-builder.tsx) كان مبني ومختبر بالكامل، بس مدفون جوّه
// صفحة تفاصيل خدمة معيّنة (/catalog/services/:id) ومش ظاهر إلا لو الخدمة أصلاً pricing_model=formula
// — والقيمة الافتراضية لأي خدمة جديدة "ثابت" (fixed)، فمفيش أي طريق مباشر في القائمة الجانبية
// يوصّل الأدمن لأهم ميزة تسعير في المشروع. الصفحة دي بترجّع نظرة عامة على كل الخدمات مع تمييز
// واضح لمين شغال بمحرك التسعير الديناميكي فعلاً، وتفعيل مباشر للي لسه لأ.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminServiceCategoryResponseDto, AdminServiceResponseDto, PricingModel } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'ثابت',
  hourly: 'بالساعة',
  per_unit: 'بالوحدة',
  inspection_then_quote: 'كشف ثم عرض سعر',
  formula: 'معادلة ديناميكية',
};

export default function PricingEnginePage() {
  const { isLoading, authedFetch } = useAuth();
  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [services, setServices] = useState<AdminServiceResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  function load() {
    authedFetch<AdminServiceCategoryResponseDto[]>('/admin/service-categories')
      .then(setCategories)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفئات'));
    authedFetch<AdminServiceResponseDto[]>('/admin/services')
      .then(setServices)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الخدمات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function activateFormulaEngine(service: AdminServiceResponseDto) {
    setActivatingId(service.id);
    setError(null);
    try {
      await authedFetch(`/admin/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pricing_model: 'formula' }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setActivatingId(null);
    }
  }

  const categoryName = (id: string) => categories?.find((c) => c.id === id)?.name_ar ?? '—';
  const formulaServices = services?.filter((s) => s.pricing_model === 'formula') ?? [];
  const otherServices = services?.filter((s) => s.pricing_model !== 'formula') ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          className="mb-0"
          title="محرك التسعير الديناميكي"
          description="لكل خدمة معادلة تسعير خاصة بيها مبنية من حقول (مساحة، عدد غرف، نوع التنفيذ...) وقواعد حساب — بدل سعر ثابت واحد لكل الحالات. إدارة الحقول/القواعد/المعاينة من صفحة كل خدمة."
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>خدمات شغالة بمحرك التسعير الديناميكي ({formulaServices.length})</CardTitle>
            <CardDescription>ادخل على أي خدمة تحت عشان تدير حقولها/قواعدها/تعاين السعر الناتج.</CardDescription>
          </CardHeader>
          <CardContent>
            {!services ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : formulaServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                مفيش أي خدمة شغالة بالمعادلة الديناميكية لسه — فعّلها من الجدول تحت.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الخدمة</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formulaServices.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>
                        <Link href={`/catalog/services/${service.id}`} className="font-medium hover:underline">
                          {service.name_ar}
                        </Link>
                      </TableCell>
                      <TableCell>{categoryName(service.category_id)}</TableCell>
                      <TableCell>
                        <Badge variant={service.is_active ? 'secondary' : 'outline'}>
                          {service.is_active ? 'نشطة' : 'معطّلة'}
                        </Badge>
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
            <CardTitle>باقي الخدمات ({otherServices.length})</CardTitle>
            <CardDescription>
              لسه بتسعير تقليدي (ثابت/بالساعة/بالوحدة/كشف ثم عرض سعر) — دوس "فعّل المعادلة" عشان
              تنقلها لمحرك التسعير الديناميكي وتبدأ تبني حقولها وقواعدها.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!services ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : otherServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">كل الخدمات بالفعل شغالة بالمعادلة الديناميكية.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الخدمة</TableHead>
                    <TableHead>الفئة</TableHead>
                    <TableHead>نوع التسعير الحالي</TableHead>
                    <TableHead>السعر الأساسي</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherServices.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>
                        <Link href={`/catalog/services/${service.id}`} className="hover:underline">
                          {service.name_ar}
                        </Link>
                      </TableCell>
                      <TableCell>{categoryName(service.category_id)}</TableCell>
                      <TableCell>{PRICING_MODEL_LABELS[service.pricing_model]}</TableCell>
                      <TableCell>{formatEgp(service.base_price_cents)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={activatingId === service.id}
                          onClick={() => activateFormulaEngine(service)}
                        >
                          {activatingId === service.id ? 'جاري التفعيل…' : 'فعّل المعادلة'}
                        </Button>
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
