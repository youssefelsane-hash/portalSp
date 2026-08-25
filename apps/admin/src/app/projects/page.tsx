'use client';

import { useCallback, useEffect, useState } from 'react';
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

const egp = (c: number) => `${(c / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

interface ProjectRow {
  id: string; project_number: string; name_ar: string; project_type: string;
  status: string; customer_full_name?: string; customer_phone?: string; description_ar?: string | null;
  budget_estimate_cents?: number | null; address_street?: string; created_at?: string;
  approved_quote_total_cents: number | null; paid_cents: number;
}

interface QuoteLine {
  description_ar: string; quantity: number; unit: string; unit_price_cents: number; total_cents: number;
  responsibility?: string;
}

interface ProjectQuoteDetail {
  id: string; version: number; status: string; work_lines: QuoteLine[]; material_lines: QuoteLine[];
  total_work_cents: number; total_materials_cents: number; total_cents: number; duration_days: number | null;
  scope_included: string | null; scope_excluded: string | null; assumptions: string | null;
  created_by_name: string | null; approved_by_name: string | null; created_at: string;
  sent_at: string | null; approved_at: string | null; expires_at: string | null;
}

// ADR-0036 — كل مرحلة بتشيل كومنتاتها جوّاها، فالكارت بيتعرض كامل من غير نداء لكل مرحلة.
interface ProjectCommentRow {
  id: string;
  milestone_id: string | null;
  author_role: string;
  author_name: string;
  body: string;
  is_visible_to_customer: boolean;
  created_at: string;
}

interface ProjectMilestoneRow {
  id: string;
  sequence_number: number;
  name_ar: string;
  amount_cents: number;
  execution_status: string;
  approval_status: string;
  payment_status?: string;
  expected_date?: string | null;
  rejection_reason?: string | null;
  comments?: ProjectCommentRow[];
}

interface ProjectRoomData {
  project: ProjectRow;
  quotes: ProjectQuoteDetail[];
  milestones: ProjectMilestoneRow[];
  orders: Array<{ id: string; order_number: string; status: string; total_amount_cents: number }>;
  warranties: Array<Record<string, unknown>>;
  activity: Array<{ id: string; action: string; actor_name: string; actor_role: string; created_at: string }>;
  comments?: ProjectCommentRow[];
}

const STATUS_LABELS: Record<string, string> = {
  draft:'مسودة', survey_requested:'طلب معاينة', survey_scheduled:'معاينة مجدولة',
  quote_preparing:'تحضير عرض', awaiting_customer_approval:'انتظار موافقة العميل',
  awaiting_deposit:'انتظار العربون', active:'نشط', paused:'متوقف',
  awaiting_milestone_approval:'انتظار موافقة مرحلة', handover_pending:'استلام نهائي',
  completed:'مكتمل', cancelled:'ملغي', disputed:'نزاع',
};

const TRANSITIONS: Record<string, {to: string; label: string; needsReason?: boolean}[]> = {
  survey_requested: [{to:'survey_scheduled',label:'جدولة المعاينة'},{to:'cancelled',label:'إلغاء',needsReason:true}],
  survey_scheduled: [{to:'quote_preparing',label:'تحضير عرض'},{to:'cancelled',label:'إلغاء',needsReason:true}],
  quote_preparing: [{to:'cancelled',label:'إلغاء',needsReason:true}],
  awaiting_customer_approval: [],
  awaiting_deposit: [{to:'active',label:'استلام العربون — بدء التنفيذ'},{to:'cancelled',label:'إلغاء',needsReason:true}],
  active: [
    {to:'paused',label:'إيقاف مؤقت',needsReason:true},
    {to:'handover_pending',label:'جاهز للتسليم'},
    {to:'disputed',label:'نزاع',needsReason:true},
    {to:'cancelled',label:'إلغاء',needsReason:true},
  ],
  paused: [{to:'active',label:'استئناف'},{to:'cancelled',label:'إلغاء',needsReason:true}],
  handover_pending: [{to:'completed',label:'تسليم نهائي'},{to:'disputed',label:'نزاع',needsReason:true}],
  disputed: [{to:'active',label:'حل النزاع'},{to:'cancelled',label:'إلغاء',needsReason:true}],
};

export default function AdminProjectsPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (isLoading) return;
    authedFetchPaginated<ProjectRow>(`/admin/projects?page=${page}&per_page=20`)
      .then(({ items, meta }) => {
        setProjects(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [isLoading, page, authedFetchPaginated]);

  useEffect(() => {
    if (isLoading) return;
    void authedFetchPaginated<ProjectRow>(`/admin/projects?page=${page}&per_page=20`)
      .then(({ items, meta }) => {
        setProjects(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [isLoading, page, authedFetchPaginated]);

  return (
    <AppShell>
      <PageHeader title="المشروعات والتشطيب" />
      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!projects && <TableSkeleton columns={6} />}
      {projects && projects.length === 0 && <EmptyState title="مفيش مشروعات" />}
      {projects && projects.length > 0 && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم</TableHead><TableHead>الاسم</TableHead>
            <TableHead>العميل</TableHead>
            <TableHead>النوع</TableHead><TableHead>الحالة</TableHead>
            <TableHead>العقد</TableHead><TableHead>مدفوع</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {projects.map((p) => (
              <ProjectRowItem key={p.id} project={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onRefresh={load} />
            ))}
          </TableBody>
        </Table>
      )}
      {projects && total > 0 && (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / 20))}
          total={total}
          itemLabel="مشروع"
          onPageChange={setPage}
        />
      )}
    </AppShell>
  );
}

function ProjectRowItem({ project, expanded, onToggle, onRefresh }: {
  project: ProjectRow; expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
  return (
    <>
      <TableRow className={expanded ? 'bg-muted/50' : ''}>
        <TableCell>
          <button onClick={onToggle} className="font-mono text-xs underline">{project.project_number}</button>
        </TableCell>
        <TableCell className="font-medium">{project.name_ar}</TableCell>
        <TableCell>
          <div className="text-sm">{project.customer_full_name || '—'}</div>
          {project.customer_phone && <div dir="ltr" className="font-mono text-xs text-muted-foreground">{project.customer_phone}</div>}
        </TableCell>
        <TableCell><Badge variant="outline">{project.project_type}</Badge></TableCell>
        <TableCell><Badge variant={project.status === 'active' ? 'secondary' : 'outline'}>{STATUS_LABELS[project.status] ?? project.status}</Badge></TableCell>
        <TableCell>{project.approved_quote_total_cents != null ? egp(project.approved_quote_total_cents) : '—'}</TableCell>
        <TableCell>{egp(project.paid_cents)}</TableCell>
        <TableCell>
          <Button size="sm" variant={expanded ? 'secondary' : 'ghost'} onClick={onToggle}>
            {expanded ? 'إغلاق' : 'إدارة'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && <ProjectDetailPanel project={project} onRefresh={onRefresh} />}
    </>
  );
}

// ── لوحة تفاصيل المشروع الموسعة ──────────────────────────────────────────────
function ProjectDetailPanel({ project, onRefresh }: { project: ProjectRow; onRefresh: () => void }) {
  const { authedFetch } = useAuth();
  const [room, setRoom] = useState<ProjectRoomData | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  const loadRoom = useCallback(() => {
    authedFetch<ProjectRoomData>(`/admin/projects/${project.id}/room`)
      .then((data) => { setRoom(data); setRoomError(null); })
      .catch((err) => setRoomError(err instanceof ApiError ? err.message : 'تعذر تحميل تفاصيل المشروع'));
  }, [authedFetch, project.id]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  const currentProject = room?.project ?? project;
  const transitions = TRANSITIONS[currentProject.status] ?? [];
  const approvedQuote = room?.quotes.find((quote) => quote.status === 'approved');
  const refresh = () => { onRefresh(); void loadRoom(); };

  return (
    <TableRow>
      <TableCell colSpan={8} className="bg-muted/30 p-4 space-y-4">
        {roomError && <p className="text-sm text-destructive">{roomError}</p>}
        {!room && !roomError && <p className="text-sm text-muted-foreground">جاري تحميل كل تفاصيل المشروع…</p>}

        <div className="grid gap-3 lg:grid-cols-3">
          <section className="rounded-md border bg-background p-3 lg:col-span-2">
            <p className="font-medium">طلب العميل</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{currentProject.description_ar?.trim() || 'لم يكتب العميل وصفًا إضافيًا.'}</p>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <span>العنوان: {currentProject.address_street || '—'}</span>
              <span>الميزانية: {currentProject.budget_estimate_cents != null ? egp(currentProject.budget_estimate_cents) : 'غير محددة'}</span>
              <span>تاريخ الطلب: {formatDate(currentProject.created_at)}</span>
            </div>
          </section>
          <section className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">الحالة الحالية</p>
            <p className="mt-1 font-medium">{STATUS_LABELS[currentProject.status] ?? currentProject.status}</p>
            <p className="mt-2 text-sm text-primary">{adminNextStep(currentProject.status, room?.milestones.length ?? 0)}</p>
          </section>
        </div>

        {approvedQuote && (
          <div className="rounded-md border border-green-300 bg-green-50 p-3 text-green-950">
            <p className="font-medium">وافق العميل على عرض السعر v{approvedQuote.version}</p>
            <p className="mt-1 text-sm">
              {approvedQuote.approved_by_name || currentProject.customer_full_name || 'العميل'} وافق بتاريخ {formatDate(approvedQuote.approved_at)}
              {' '}على إجمالي {egp(approvedQuote.total_cents)}.
            </p>
          </div>
        )}

        {room && room.quotes.length > 0 && (
          <section className="space-y-2">
            <p className="font-medium text-sm">عروض السعر</p>
            {room.quotes.map((quote) => <AdminQuoteDetails key={quote.id} quote={quote} />)}
          </section>
        )}

        {room && room.milestones.length > 0 && (
          <section className="rounded-md border bg-background p-3">
            <p className="mb-1 font-medium text-sm">مراحل التنفيذ</p>
            {/* docs/08 §57 بند 3 — كل مرحلة كارت مستقل بسعرها وأفعالها وكومنتاتها، بدل سطر
                للقراءة بس. الترتيب مش مفروض: أي مرحلة "لسه ما بدأتش" تقدر تبدأ لوحدها. */}
            <p className="mb-3 text-xs text-muted-foreground">
              كل مرحلة بتتسلّم لوحدها. أول ما تسلّم مرحلة، العميل بيتراجعها ويوافق — ولو ماردّش
              خلال المهلة بتتوافق تلقائيًا.
            </p>
            <div className="grid gap-3">
              {room.milestones.map((milestone) => (
                <MilestoneCard key={milestone.id} projectId={currentProject.id} milestone={milestone} onChanged={loadRoom} />
              ))}
            </div>
          </section>
        )}

        <div>
          <p className="mb-2 font-medium text-sm">الإجراء التالي</p>
          <div className="flex flex-wrap gap-2">
            {transitions.length > 0 ? transitions.map((t) => (
              <TransitionButton key={t.to} projectId={project.id} to={t.to} label={t.label}
                needsReason={t.needsReason} onDone={refresh} />
            )) : <span className="text-sm text-muted-foreground">لا يوجد انتقال يدوي مطلوب في الحالة الحالية.</span>}
          </div>
        </div>

        {currentProject.status === 'quote_preparing' && (
          <QuoteCreationSection projectId={project.id} onCreated={refresh} />
        )}

        {currentProject.status === 'awaiting_deposit' && (room?.milestones.length ?? 0) === 0 && (
          <MilestoneCreationSection projectId={project.id} approvedTotal={currentProject.approved_quote_total_cents ?? 0} onCreated={refresh} />
        )}

        {room && room.activity.length > 0 && (
          <section className="rounded-md border bg-background p-3">
            <p className="mb-3 font-medium text-sm">سجل من فعل ماذا</p>
            <div className="space-y-2">
              {room.activity.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0">
                  <span>{activityLabel(item.action)}</span>
                  <span className="text-xs text-muted-foreground">{item.actor_name || 'النظام'} · {formatDate(item.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </TableCell>
    </TableRow>
  );
}

function AdminQuoteDetails({ quote }: { quote: ProjectQuoteDetail }) {
  return (
    <details className="rounded-md border bg-background p-3" open={quote.status === 'approved' || quote.status === 'sent'}>
      <summary className="cursor-pointer font-medium">
        عرض v{quote.version} · {quoteStatusLabel(quote.status)} · {egp(quote.total_cents)}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <QuoteLines title="الأعمال" lines={quote.work_lines} />
        <QuoteLines title="الخامات" lines={quote.material_lines} />
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
          <span>مدة التنفيذ: {quote.duration_days != null ? `${quote.duration_days} يوم` : '—'}</span>
          <span>أرسله: {quote.created_by_name || 'الإدارة'} · {formatDate(quote.sent_at)}</span>
          <span>الموافقة: {quote.approved_at ? `${quote.approved_by_name || 'العميل'} · ${formatDate(quote.approved_at)}` : 'لم يوافق العميل بعد'}</span>
        </div>
        {quote.scope_included && <p><strong>النطاق المشمول:</strong> {quote.scope_included}</p>}
        {quote.scope_excluded && <p><strong>غير المشمول:</strong> {quote.scope_excluded}</p>}
        {quote.assumptions && <p><strong>ملاحظات وافتراضات:</strong> {quote.assumptions}</p>}
      </div>
    </details>
  );
}

function QuoteLines({ title, lines }: { title: string; lines: QuoteLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      {lines.map((line, index) => (
        <div key={`${line.description_ar}-${index}`} className="flex justify-between gap-3 border-b py-1 last:border-0">
          <span>{line.description_ar}</span>
          <span className="whitespace-nowrap text-muted-foreground">{line.quantity} {line.unit} × {egp(line.unit_price_cents)} = {egp(line.total_cents)}</span>
        </div>
      ))}
    </div>
  );
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('ar-EG-u-nu-latn') : '—';
}

function quoteStatusLabel(status: string) {
  return ({ draft: 'مسودة', sent: 'بانتظار العميل', approved: 'وافق العميل', rejected: 'مرفوض', expired: 'منتهي', superseded: 'مستبدل' } as Record<string, string>)[status] ?? status;
}

function adminNextStep(status: string, milestoneCount: number) {
  const labels: Record<string, string> = {
    survey_requested: 'جدول المعاينة مع العميل.', survey_scheduled: 'ابدأ تجهيز عرض السعر بعد المعاينة.',
    quote_preparing: 'اكتب عرض السعر الكامل وأرسله للعميل.', awaiting_customer_approval: 'العرض عند العميل؛ لا يلزم إجراء حتى يوافق.',
    awaiting_deposit: milestoneCount > 0 ? 'المراحل جاهزة؛ سجّل استلام العربون وابدأ التنفيذ.' : 'العميل وافق؛ أنشئ مراحل التنفيذ والعربون الآن.',
    active: 'تابع تنفيذ المراحل والطلبات المرتبطة.', handover_pending: 'أكمل التسليم النهائي.',
  };
  return labels[status] ?? 'راجع سجل المشروع وحدد الإجراء المسموح.';
}

function activityLabel(action: string) {
  return ({
    'project.created': 'أنشأ العميل المشروع', 'project.survey_scheduled': 'حددت الإدارة المعاينة',
    'project.quote_preparing': 'بدأت الإدارة تجهيز العرض', 'project.quote_created': 'أنشأت الإدارة عرض السعر',
    'project.quote_sent': 'أرسلت الإدارة عرض السعر', 'project.quote_approved': 'وافق العميل على عرض السعر',
    'project.milestones_created': 'أنشأت الإدارة مراحل المشروع', 'project.active': 'بدأ تنفيذ المشروع',
    'project.completed': 'اكتمل المشروع', 'project.cancelled': 'تم إلغاء المشروع',
  } as Record<string, string>)[action] ?? action;
}

function TransitionButton({ projectId, to, label, needsReason, onDone }: {
  projectId: string; to: string; label: string; needsReason?: boolean; onDone: () => void;
}) {
  const { authedFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    let reason: string | undefined;
    if (needsReason) {
      const raw = window.prompt(`سبب ${label} (إجباري):`);
      if (!raw?.trim()) return;
      reason = raw.trim();
    }
    setBusy(true); setError(null);
    try {
      await authedFetch(`/admin/projects/${projectId}/transition`, {
        method: 'POST', body: JSON.stringify({ to, reason }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void go()}>
        {busy ? '…' : label}
      </Button>
      {error && <p className="text-xs text-destructive mt-1 max-w-xs">{error}</p>}
    </div>
  );
}

// ── إنشاء عرض سعر ──
function QuoteCreationSection({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const { authedFetch } = useAuth();
  const [workDesc, setWorkDesc] = useState('');
  const [workQty, setWorkQty] = useState(1);
  const [workPrice, setWorkPrice] = useState(0);
  const [matDesc, setMatDesc] = useState('');
  const [matQty, setMatQty] = useState(1);
  const [matPrice, setMatPrice] = useState(0);
  const [matResponsibility, setMatResponsibility] = useState('provider_supplied');
  const [scope, setScope] = useState('');
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!workDesc.trim() || workQty < 1 || workPrice < 1) { setError('املأ بند العمل'); return; }
    setBusy(true); setError(null);
    const work_lines = [{ description_ar: workDesc.trim(), quantity: workQty, unit: 'وحدة', unit_price_cents: workPrice }];
    const material_lines = matDesc.trim() && matPrice > 0
      ? [{ description_ar: matDesc.trim(), responsibility: matResponsibility, quantity: matQty, unit: 'وحدة', unit_price_cents: matPrice }]
      : [];
    try {
      const quote = await authedFetch<{ id: string }>(`/admin/projects/${projectId}/quotes`, {
        method: 'POST', body: JSON.stringify({ work_lines, material_lines, scope_included: scope, duration_days: duration }),
      });
      await authedFetch(`/admin/projects/${projectId}/quotes/${quote.id}/send`, { method: 'POST' });
      onCreated();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="font-medium text-sm">إنشاء عرض سعر:</p>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">وصف العمل *</Label><Input value={workDesc} onChange={(e) => setWorkDesc(e.target.value)} placeholder="مثلاً: دهان شقق" /></div>
        <div className="grid grid-cols-2 gap-1">
          <div><Label className="text-xs">الكمية *</Label><Input type="number" min={1} value={workQty} onChange={(e) => setWorkQty(Number(e.target.value))} /></div>
          <div><Label className="text-xs">سعر الوحدة (قرش) *</Label><Input type="number" min={1} value={workPrice} onChange={(e) => setWorkPrice(Number(e.target.value))} /></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">وصف المادة</Label><Input value={matDesc} onChange={(e) => setMatDesc(e.target.value)} placeholder="اختياري" /></div>
        <div className="grid grid-cols-2 gap-1">
          <div><Label className="text-xs">الكمية</Label><Input type="number" min={1} value={matQty} onChange={(e) => setMatQty(Number(e.target.value))} /></div>
          <div><Label className="text-xs">سعر الوحدة (قرش)</Label><Input type="number" min={0} value={matPrice} onChange={(e) => setMatPrice(Number(e.target.value))} /></div>
        </div>
        <div className="col-span-2">
          <Label className="text-xs">جهة التوفير</Label>
          <select value={matResponsibility} onChange={(e) => setMatResponsibility(e.target.value)} className="w-full rounded border px-2 py-1 text-sm">
            <option value="provider_supplied">الشركة/الفني</option>
            <option value="customer_supplied">العميل</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">المدة (يوم)</Label><Input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
        <div><Label className="text-xs">النطاق المشمول</Label><Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="اختياري" /></div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button size="sm" disabled={busy} onClick={() => void create()}>{busy ? '…' : 'إنشاء العرض وإرساله للعميل'}</Button>
    </div>
  );
}

// ── إنشاء مراحل ──
function MilestoneCreationSection({ projectId, approvedTotal, onCreated }: {
  projectId: string; approvedTotal: number; onCreated: () => void;
}) {
  const { authedFetch } = useAuth();
  const [milestones, setMilestones] = useState([
    { name_ar: 'عربون', amount_egp: 0, is_down_payment: true },
    { name_ar: 'تنفيذ', amount_egp: 0, is_down_payment: false },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalEgp = milestones.reduce((s, m) => s + Number(m.amount_egp || 0), 0);
  const totalCents = approvedTotal;
  const matches = Math.round(totalEgp * 100) === totalCents;

  function updateMilestone(i: number, field: string, value: unknown) {
    const next = [...milestones];
    next[i] = { ...next[i], [field]: value };
    setMilestones(next);
  }

  function addMilestone() {
    setMilestones([...milestones, { name_ar: '', amount_egp: 0, is_down_payment: false }]);
  }

  async function create() {
    if (!matches) { setError('المجموع لا يساوي قيمة العرض'); return; }
    setBusy(true); setError(null);
    try {
      await authedFetch(`/admin/projects/${projectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({
          milestones: milestones.map((m) => ({
            name_ar: m.name_ar, amount_cents: Math.round(Number(m.amount_egp) * 100),
            is_down_payment: m.is_down_payment,
          })),
        }),
      });
      onCreated();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="font-medium text-sm">
        إنشاء مراحل المشروع:
        <span className={`ms-2 text-xs ${matches ? 'text-green-600' : 'text-destructive'}`}>
          المجموع: {egp(Math.round(totalEgp * 100))} / {egp(totalCents)} {matches ? '✓' : '✗'}
        </span>
      </p>
      {milestones.map((m, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1"><Label className="text-xs">الاسم</Label>
            <Input value={m.name_ar} onChange={(e) => updateMilestone(i, 'name_ar', e.target.value)} /></div>
          <div className="w-28"><Label className="text-xs">المبلغ (ج.م)</Label>
            <Input type="number" min={0} value={m.amount_egp} onChange={(e) => updateMilestone(i, 'amount_egp', Number(e.target.value))} /></div>
          <label className="flex items-center gap-1 text-xs pb-2">
            <input type="checkbox" checked={m.is_down_payment} onChange={(e) => updateMilestone(i, 'is_down_payment', e.target.checked)} />
            عربون
          </label>
        </div>
      ))}
      <Button size="sm" variant="outline" type="button" onClick={addMilestone}>
        + إضافة مرحلة
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button size="sm" disabled={busy || !matches} onClick={() => void create()}>
        {busy ? '…' : 'إنشاء المراحل'}
      </Button>
    </div>
  );
}

// كارت المرحلة الواحدة (ADR-0036، docs/08 §57 بند 3) — بلاغ المالك: "الأدمن بيسلّم كله مع بعض،
// وده مش منطقي. مفروض كل مرحلة تكون منفصلة بحدها، مكتوب جنبها سعرها… وكل فيز تسمح إن هي تتسلم
// على حدة، ويبقى في كل فيز مساحة كومنتات بتظهر للعميل."
const MILESTONE_EXECUTION_LABELS: Record<string, string> = {
  pending: 'لسه ما بدأتش', in_progress: 'شغّالة', completed: 'اتسلّمت', rejected: 'مرفوضة',
};
const MILESTONE_APPROVAL_LABELS: Record<string, string> = {
  pending: 'بانتظار موافقة العميل', approved: 'العميل وافق', rejected: 'العميل رفض',
};

function MilestoneCard({
  projectId,
  milestone,
  onChanged,
}: {
  projectId: string;
  milestone: ProjectMilestoneRow;
  onChanged: () => void;
}) {
  const { authedFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [internal, setInternal] = useState(false);

  async function act(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/projects/${projectId}/milestones/${milestone.id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!commentBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/projects/${projectId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: commentBody.trim(),
          milestone_id: milestone.id,
          is_visible_to_customer: !internal,
        }),
      });
      setCommentBody('');
      setInternal(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إضافة الكومنت');
    } finally {
      setBusy(false);
    }
  }

  const comments = milestone.comments ?? [];

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-sm">
          {milestone.sequence_number}. {milestone.name_ar}
        </span>
        <span className="font-medium text-sm">{egp(milestone.amount_cents)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant={milestone.execution_status === 'completed' ? 'default' : 'secondary'}>
          {MILESTONE_EXECUTION_LABELS[milestone.execution_status] ?? milestone.execution_status}
        </Badge>
        {milestone.execution_status === 'completed' && (
          <Badge variant={milestone.approval_status === 'approved' ? 'default' : 'secondary'}>
            {MILESTONE_APPROVAL_LABELS[milestone.approval_status] ?? milestone.approval_status}
          </Badge>
        )}
        {milestone.expected_date && (
          <span className="text-xs text-muted-foreground">الموعد المتوقع: {milestone.expected_date}</span>
        )}
      </div>

      {milestone.rejection_reason && (
        <p className="mt-2 text-xs text-destructive">سبب رفض العميل: {milestone.rejection_reason}</p>
      )}

      {/* الترتيب مش مفروض: أي مرحلة "لسه ما بدأتش" تقدر تبدأ لوحدها من غير ما تستنى اللي قبلها. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {milestone.execution_status === 'pending' && (
          <Button size="sm" disabled={busy} onClick={() => act('start')}>
            ابدأ المرحلة دي
          </Button>
        )}
        {milestone.execution_status === 'in_progress' && (
          <Button size="sm" disabled={busy} onClick={() => act('complete')}>
            سلّم المرحلة دي
          </Button>
        )}
      </div>

      <div className="mt-3 border-t pt-2">
        <p className="mb-1 text-xs font-medium">كومنتات المرحلة</p>
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">مفيش كومنتات لسه.</p>
        ) : (
          <ul className="mb-2 space-y-1">
            {comments.map((c) => (
              <li key={c.id} className="text-xs">
                <span className="font-medium">{c.author_name}:</span> {c.body}
                {!c.is_visible_to_customer && (
                  <span className="ms-1 text-muted-foreground">(داخلي — العميل مش شايفه)</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <Input
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="اكتب تحديث للعميل عن المرحلة دي…"
        />
        <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          ملاحظة داخلية (مش هتظهر للعميل)
        </label>
        <Button size="sm" variant="outline" className="mt-2" disabled={busy || !commentBody.trim()} onClick={submitComment}>
          أضف الكومنت
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
