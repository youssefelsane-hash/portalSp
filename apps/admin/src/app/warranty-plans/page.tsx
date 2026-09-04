'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeServiceOptions, type ServiceOption, type ServicesResponse } from './warranty-plan-services';

interface WarrantyPlanRow {
  id: string; slug: string; name_ar: string; warranty_type: string;
  pricing_model: string; price_value: string; coverage_months: number;
  max_coverage_cents: number | null; max_claims: number;
  is_active: boolean; version: number;
  target_service_id: string | null;
  targetServiceId?: string | null;
}

function linkedServiceId(plan: WarrantyPlanRow): string {
  return plan.target_service_id ?? plan.targetServiceId ?? '';
}

export default function AdminWarrantyPlansPage() {
  const { isLoading, authedFetch } = useAuth();
  const [plans, setPlans] = useState<WarrantyPlanRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);

  const load = () => {
    authedFetch<WarrantyPlanRow[]>('/admin/warranty-plans').then(setPlans).catch((e) => setError(e instanceof ApiError ? e.message : 'خطأ'));
  };
  useEffect(() => {
    // **بَقّة حقيقية اتلقطت بزحف بصري على كل لينكات القائمة (docs/08 §133)**: الصفحة دي كانت
    // الوحيدة من ٤٤ صفحة اللي بترجع 401 على كل تحميل. السبب إنها بتنادي الـAPI **قبل ما
    // التوكن يجهز** — كل الصفحات التانية بتستنى `isLoading`. والأسوأ إن الـdeps فاضية
    // (`[]`) فالمحاولة مابتتكررش لما التوكن يوصل: الجدول يفضل فاضي وقايمة الخدمات فاضية
    // والرسالة الوحيدة «خطأ» بلا أي تفسير.
    if (isLoading) return;
    load();
    authedFetch<ServicesResponse>('/admin/services?per_page=200&is_active=true')
      .then((result) => setServices(normalizeServiceOptions(result)))
      .catch((err: unknown) => {
        console.error('فشل تحميل الخدمات لخطط الضمان', err);
        setServices([]);
      });
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(plan: WarrantyPlanRow) {
    try {
      await authedFetch(`/admin/warranty-plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !plan.is_active }) });
      load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
  }

  async function assignService(plan: WarrantyPlanRow, serviceId: string) {
    try {
      await authedFetch(`/admin/warranty-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ target_service_id: serviceId || null }),
      });
      load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
  }

  return (
    <AppShell>
      <PageHeader title="خطط الضمان" />
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'إلغاء' : '+ إنشاء خطة ضمان'}</Button>
      </div>
      {error && <p className="text-destructive mb-4">{error}</p>}

      {showCreate && <CreateWarrantyPlanForm services={services} onCreated={() => { setShowCreate(false); load(); }} />}

      {!plans && <TableSkeleton columns={6} />}
      {plans && plans.length === 0 && <EmptyState title="مفيش خطط ضمان" />}
      {plans && plans.length > 0 && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>النوع</TableHead>
            <TableHead>الخدمة</TableHead><TableHead>السعر</TableHead><TableHead>التغطية</TableHead>
            <TableHead>عدد المطالبات</TableHead><TableHead>نشطة</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name_ar}</TableCell>
                <TableCell><Badge variant="outline">{p.warranty_type === 'workmanship' ? 'ضمان تنفيذ' : 'ضمان ممتد'}</Badge></TableCell>
                <TableCell>
                  <select
                    value={linkedServiceId(p)}
                    onChange={(event) => void assignService(p, event.target.value)}
                    className="w-full rounded border px-2 py-1 text-sm"
                  >
                    <option value="">غير مربوط</option>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.name_ar}</option>)}
                  </select>
                </TableCell>
                <TableCell>{p.pricing_model === 'fixed' ? `${(Number(p.price_value) / 100).toLocaleString()} ج.م` : `${p.price_value}%`}</TableCell>
                <TableCell>{p.coverage_months} شهر</TableCell>
                <TableCell>{p.max_claims}</TableCell>
                <TableCell><Badge variant={p.is_active ? 'secondary' : 'outline'}>{p.is_active ? 'نشطة' : 'موقوفة'}</Badge></TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => void toggleActive(p)}>{p.is_active ? 'إيقاف' : 'تفعيل'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}

function CreateWarrantyPlanForm({ onCreated, services }: { onCreated: () => void; services: ServiceOption[] }) {
  const { authedFetch } = useAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState('extended_workmanship');
  const [pricingModel, setPricingModel] = useState('fixed');
  const [priceValue, setPriceValue] = useState(0);
  const [coverageMonths, setCoverageMonths] = useState(12);
  const [maxClaims, setMaxClaims] = useState(1);
  const [serviceId, setServiceId] = useState('');
  const [terms, setTerms] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || coverageMonths < 1 || !serviceId) { setError('املأ الاسم والمدة واختر الخدمة'); return; }
    setSaving(true); setError(null);
    try {
      await authedFetch('/admin/warranty-plans', {
        method: 'POST',
        body: JSON.stringify({
          slug: `wp-${Date.now()}`, name_ar: name.trim(), warranty_type: type,
          pricing_model: pricingModel, price_value: pricingModel === 'fixed' ? Math.round(priceValue * 100) : priceValue,
          coverage_months: coverageMonths, max_claims: maxClaims,
          target_service_id: serviceId,
          terms_ar: terms.trim() || undefined, exclusions_ar: exclusions.trim() || undefined,
        }),
      });
      onCreated();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="mb-6 rounded-md border p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>اسم الخطة *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: ضمان سنتين" /></div>
        <div><Label>الخدمة التي يظهر عليها الضمان *</Label>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full rounded border px-2 py-1 text-sm">
            <option value="">اختر الخدمة</option>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name_ar}</option>)}
          </select></div>
        <div><Label>النوع</Label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded border px-2 py-1 text-sm">
            <option value="extended_workmanship">ضمان ممتد</option>
            <option value="workmanship">ضمان تنفيذ</option>
          </select></div>
        <div><Label>نموذج التسعير</Label>
          <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value)} className="w-full rounded border px-2 py-1 text-sm">
            <option value="fixed">مبلغ ثابت (ج.م)</option>
            <option value="percentage">نسبة من قيمة العقد (%)</option>
          </select></div>
        <div><Label>القيمة *</Label><Input type="number" min={0} value={priceValue} onChange={(e) => setPriceValue(Number(e.target.value))} /></div>
        <div><Label>مدة التغطية (شهر) *</Label><Input type="number" min={1} max={120} value={coverageMonths} onChange={(e) => setCoverageMonths(Number(e.target.value))} /></div>
        <div><Label>عدد المطالبات المسموحة</Label><Input type="number" min={1} value={maxClaims} onChange={(e) => setMaxClaims(Number(e.target.value))} /></div>
      </div>
      <div><Label>الشروط والأحكام</Label><textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="w-full rounded border p-2 text-sm" rows={3} placeholder="شروط التغطية…" /></div>
      <div><Label>الاستثناءات</Label><textarea value={exclusions} onChange={(e) => setExclusions(e.target.value)} className="w-full rounded border p-2 text-sm" rows={2} placeholder="ما لا يشمله الضمان…" /></div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button size="sm" disabled={saving} onClick={() => void submit()}>{saving ? '…' : 'إنشاء'}</Button>
    </div>
  );
}
