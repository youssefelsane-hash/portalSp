'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminRecurringPlanResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PER_PAGE = 20;
const egp = (cents: number) => `${(cents / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

// ── أنواع الردود ──────────────────────────────────────────────────────────────
interface ApplicationRow {
  id: string; order_id: string; customer_full_name: string; customer_phone: string;
  order_number: string | null; service_name_ar: string; plan_name_ar: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'cancelled';
  service_price_cents: number; financing_fee_cents: number; total_financed_cents: number;
  down_payment_cents: number; installment_count: number;
  regular_installment_cents: number; final_installment_cents: number;
  submitted_at: string; rejection_reason: string | null;
}
interface ScheduleRow {
  application_id: string; order_number: string | null; customer_full_name: string;
  customer_phone: string; total_financed_cents: number; paid_cents: number;
  scheduled_count: number; failed_count: number; next_due_at: string | null;
}
interface PlanRow {
  id: string; nameAr: string; installmentCount: number; intervalDays: number;
  financingPercentage: string; fixedFeeCents: number; downPaymentPercentage: string;
  minOrderAmountCents: number | null; maxOrderAmountCents: number | null;
  isActive: boolean;
}

// ── المكون الرئيسي ────────────────────────────────────────────────────────────
export default function InstallmentsPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [tab, setTab] = useState<'applications' | 'plans'>('applications');
  const [statusFilter, setStatusFilter] = useState<'pending_review' | 'all'>('pending_review');
  const [page, setPage] = useState(1);
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const loadApps = useCallback(() => {
    if (tab !== 'applications') return;
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    authedFetchPaginated<ApplicationRow>(`/admin/installments/applications?${params.toString()}`)
      .then(({ items, meta }) => { setApps(items); setTotal(meta.total ?? items.length); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [tab, page, statusFilter, authedFetchPaginated]);

  useEffect(() => { if (!isLoading) loadApps(); }, [isLoading, tab, page, statusFilter, loadApps]);

  async function act(id: string, decision: 'approve' | 'reject', reason?: string) {
    setActingId(id); setError(null);
    try {
      await authedFetch(`/admin/installments/applications/${id}/${decision}`, {
        method: 'POST', body: JSON.stringify(decision === 'reject' ? { reason } : {}),
      });
      loadApps();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'حصل خطأ'); }
    finally { setActingId(null); }
  }

  return (
    <AppShell>
      <PageHeader title="التقسيط" />
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'applications' ? 'default' : 'outline'} onClick={() => setTab('applications')}>
          طلبات المراجعة
        </Button>
        <Button size="sm" variant={tab === 'plans' ? 'default' : 'outline'} onClick={() => setTab('plans')}>
          الخطط والخدمات
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}

      {tab === 'applications' && (
        <>
          <div className="mb-4 flex gap-2">
            {(['pending_review', 'all'] as const).map((value) => (
              <Button key={value} size="sm" variant={statusFilter === value ? 'default' : 'outline'}
                onClick={() => { setStatusFilter(value); setPage(1); }}>
                {value === 'pending_review' ? 'في انتظار المراجعة' : 'الكل'}
              </Button>
            ))}
          </div>
          {!apps && <TableSkeleton columns={7} />}
          {apps && apps.length === 0 && <EmptyState title="مفيش طلبات مطابقة" />}
          {apps && apps.length > 0 && (
            <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>العميل</TableHead><TableHead>الطلب</TableHead><TableHead>الخدمة</TableHead>
                  <TableHead>الخطة</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {apps.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="text-sm">{row.customer_full_name}</div>
                        <div dir="ltr" className="font-mono text-xs text-muted-foreground">{row.customer_phone}</div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/orders/${row.order_id}`} className="underline">{row.order_number ?? row.order_id.slice(0, 8)}</Link>
                      </TableCell>
                      <TableCell>{row.service_name_ar}</TableCell>
                      <TableCell>{row.plan_name_ar}</TableCell>
                      <TableCell>
                        <span className="font-medium">{egp(row.total_financed_cents)}</span>
                        <div className="text-xs text-muted-foreground">{row.installment_count} أقساط ≈ {egp(row.regular_installment_cents)}</div>
                      </TableCell>
                      <TableCell>
                        {row.status === 'pending_review' && <Badge>مراجعة</Badge>}
                        {row.status === 'approved' && <Badge variant="secondary">معتمدة</Badge>}
                        {row.status === 'rejected' && <Badge variant="destructive" title={row.rejection_reason ?? ''}>مرفوضة</Badge>}
                        {row.status === 'cancelled' && <Badge variant="outline">ملغاة</Badge>}
                      </TableCell>
                      <TableCell>
                        {row.status === 'pending_review' && (
                          <div className="flex gap-2">
                            <Button size="sm" disabled={actingId === row.id} onClick={() => void act(row.id, 'approve')}>اعتماد</Button>
                            <Button size="sm" variant="outline" disabled={actingId === row.id}
                              onClick={() => { const r = window.prompt('سبب الرفض (إجباري):'); if (r?.trim()) void act(row.id, 'reject', r.trim()); }}>رفض</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PER_PAGE))} total={total} itemLabel="طلب" onPageChange={setPage} />
            </>
          )}
        </>
      )}

      {tab === 'plans' && <PlansTab />}
    </AppShell>
  );
}

// ── إدارة الخطط ──────────────────────────────────────────────────────────────
function PlansTab() {
  const { authedFetch, authedFetchPaginated } = useAuth();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<{ items: { id: string; name_ar: string }[]; meta: { total: number } } | null>(null);

  const loadPlans = useCallback(() => {
    authedFetch<PlanRow[]>('/admin/installments/plans').then(setPlans).catch((e) => setError(e instanceof ApiError ? e.message : 'خطأ'));
  }, [authedFetch]);
  const loadServices = useCallback(() => {
    authedFetchPaginated<{ id: string; name_ar: string }>('/admin/services?per_page=200&is_active=true')
      .then((r) => setServices(r as never)).catch(() => {});
  }, [authedFetchPaginated]);

  useEffect(() => { loadPlans(); loadServices(); }, [loadPlans, loadServices]);

  async function toggleActive(plan: PlanRow) {
    setSaving(true);
    try {
      await authedFetch(`/admin/installments/plans/${plan.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_active: !plan.isActive }),
      });
      loadPlans();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'إلغاء' : '+ إنشاء خطة جديدة'}
        </Button>
        <span className="text-sm text-muted-foreground">الخطة لازم تتربط بخدمة واحدة على الأقل عشان تظهر للعملاء.</span>
      </div>

      {error && <p className="text-destructive mb-4">{error}</p>}

      {showCreate && <CreatePlanForm onCreated={() => { setShowCreate(false); loadPlans(); }} services={services?.items ?? []} />}

      {!plans && <TableSkeleton columns={6} />}
      {plans && plans.length === 0 && <EmptyState title="مفيش خطط تقسيط — ابدأ بإنشاء خطة جديدة" />}
      {plans && plans.length > 0 && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>عدد الأقساط</TableHead><TableHead>الفاصل (يوم)</TableHead>
            <TableHead>تمويل %</TableHead><TableHead>مقدم %</TableHead><TableHead>الحد الأدنى</TableHead>
            <TableHead>نشطة</TableHead><TableHead>خدمات مرتبطة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <PlanRowExpandable key={plan.id} plan={plan} expanded={expandedId === plan.id}
                onToggle={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
                onToggleActive={() => void toggleActive(plan)} services={services?.items ?? []}
                onRefresh={loadPlans} saving={saving} />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

// صف خطة قابل للتوسع — يعرض الخدمات المرتبطة + نموذج ربط
function PlanRowExpandable({ plan, expanded, onToggle, onToggleActive, services, onRefresh, saving }: {
  plan: PlanRow; expanded: boolean; onToggle: () => void; onToggleActive: () => void;
  services: { id: string; name_ar: string }[]; onRefresh: () => void; saving: boolean;
}) {
  const { authedFetch } = useAuth();
  const [linkedServices, setLinkedServices] = useState<{ id: string; name_ar: string }[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadLinked = useCallback(async () => {
    try {
      const rows = await authedFetch<{ id: string; name_ar: string }[]>(`/admin/installments/plans/${plan.id}/services`);
      setLinkedServices(rows);
    } catch { /* ignore */ }
  }, [authedFetch, plan.id]);

  useEffect(() => { if (expanded) loadLinked(); }, [expanded, loadLinked]);

  async function link(serviceId: string) {
    if (!serviceId) return;
    setBusy(true);
    try {
      await authedFetch(`/admin/installments/services/${serviceId}/plans/${plan.id}/link`, { method: 'POST' });
      await loadLinked();
    } catch {} finally { setBusy(false); }
  }

  async function unlink(serviceId: string) {
    setBusy(true);
    try {
      await authedFetch(`/admin/installments/services/${serviceId}/plans/${plan.id}/unlink`, { method: 'POST' });
      await loadLinked();
    } catch {} finally { setBusy(false); }
  }

  const unlinked = services.filter((s) => !linkedServices.some((l) => l.id === s.id));

  return (
    <>
      <TableRow className={expanded ? 'bg-muted/50' : ''}>
        <TableCell>
          <button onClick={onToggle} className="font-medium underline-offset-2 hover:underline">
            {expanded ? '▾' : '▸'} {plan.nameAr}
          </button>
        </TableCell>
        <TableCell>{plan.installmentCount}</TableCell>
        <TableCell>{plan.intervalDays}</TableCell>
        <TableCell>{Number(plan.financingPercentage)}%</TableCell>
        <TableCell>{Number(plan.downPaymentPercentage)}%</TableCell>
        <TableCell>{plan.minOrderAmountCents != null ? egp(plan.minOrderAmountCents) : '—'}</TableCell>
        <TableCell>
          <Badge variant={plan.isActive ? 'secondary' : 'outline'}>{plan.isActive ? 'نشطة' : 'موقوفة'}</Badge>
        </TableCell>
        <TableCell>
          <Button size="sm" variant={plan.isActive ? 'outline' : 'ghost'} disabled={saving} onClick={onToggleActive}>
            {plan.isActive ? 'إيقاف' : 'تفعيل'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-4">
            <p className="mb-2 font-medium text-sm">الخدمات المرتبطة:</p>
            {linkedServices.length === 0 && <p className="text-sm text-muted-foreground mb-2">مفيش خدمات مرتبطة</p>}
            <div className="flex flex-wrap gap-2 mb-3">
              {linkedServices.map((svc) => (
                <span key={svc.id} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
                  {svc.name_ar}
                  <button className="ml-1 text-destructive" disabled={busy}
                    onClick={() => void unlink(svc.id)}>✕</button>
                </span>
              ))}
            </div>
            {unlinked.length > 0 && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">ربط خدمة جديدة:</Label>
                <select value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)}
                  className="rounded border bg-surface px-2 py-1 text-sm">
                  <option value="">اختار خدمة…</option>
                  {unlinked.map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
                </select>
                <Button size="sm" disabled={!selectedServiceId || busy}
                  onClick={() => void link(selectedServiceId)}>ربط</Button>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// نموذج إنشاء خطة جديدة
function CreatePlanForm({ onCreated, services }: { onCreated: () => void; services: { id: string; name_ar: string }[] }) {
  const { authedFetch } = useAuth();
  const [name, setName] = useState('');
  const [count, setCount] = useState(6);
  const [intervalDays, setIntervalDays] = useState(30);
  const [financingPct, setFinancingPct] = useState(0);
  const [downPct, setDownPct] = useState(0);
  const [minCents, setMinCents] = useState<number | ''>('');
  const [maxCents, setMaxCents] = useState<number | ''>('');
  const [docReqs, setDocReqs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || count < 1 || count > 60) { setError('املأ الاسم وعدد الأقساط بشكل صحيح'); return; }
    setSaving(true); setError(null);
    const docRequirements = docReqs.trim()
      ? docReqs.split(',').map((d) => ({ doc_type: d.trim().replace(/\s+/g, '_'), label_ar: d.trim(), is_required: true }))
      : undefined;
    try {
      await authedFetch('/admin/installments/plans', {
        method: 'POST',
        body: JSON.stringify({
          name_ar: name.trim(),
          installment_count: count,
          interval_days: intervalDays,
          financing_percentage: financingPct,
          down_payment_percentage: downPct,
          min_order_amount_cents: minCents ? Math.round(Number(minCents) * 100) : undefined,
          max_order_amount_cents: maxCents ? Math.round(Number(maxCents) * 100) : undefined,
          document_requirements: docRequirements,
        }),
      });
      onCreated();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'حصل خطأ'); }
    finally { setSaving(false); }
  }

  return (
    <div className="mb-6 rounded-md border p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div><Label>اسم الخطة *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: 6 شهور" /></div>
        <div><Label>عدد الأقساط *</Label><Input type="number" min={1} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} /></div>
        <div><Label>الفاصل بالأيام</Label><Input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} /></div>
        <div><Label>نسبة التمويل %</Label><Input type="number" min={0} step={0.01} value={financingPct} onChange={(e) => setFinancingPct(Number(e.target.value))} /></div>
        <div><Label>نسبة المقدم %</Label><Input type="number" min={0} max={100} step={0.01} value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><Label>أدنى مبلغ (ج.م)</Label><Input type="number" min={0} value={minCents} onChange={(e) => setMinCents(e.target.value ? Number(e.target.value) : '')} placeholder="اختياري" /></div>
        <div><Label>أقصى مبلغ (ج.م)</Label><Input type="number" min={0} value={maxCents} onChange={(e) => setMaxCents(e.target.value ? Number(e.target.value) : '')} placeholder="اختياري" /></div>
        <div className="col-span-2"><Label>مستندات مطلوبة (مفصولة بفاصلة)</Label><Input value={docReqs} onChange={(e) => setDocReqs(e.target.value)} placeholder="صورة البطاقة، إثبات عنوان" /></div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button size="sm" disabled={saving} onClick={() => void submit()}>{saving ? 'جاري الحفظ…' : 'إنشاء الخطة'}</Button>
    </div>
  );
}
