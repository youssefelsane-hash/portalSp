'use client';

import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { BUCKET_LABELS } from '../page';

/**
 * **ملف المخاطر** (ADR-0085) — مش صفحة الفني العادية.
 *
 * الصفحة دي بتجاوب سؤال واحد: **«ليه النظام شايف الشخص ده مشبوه، وإيه اللي أعمله؟»**
 *
 * القاعدة الحاكمة: **الدرجة بتتعرض مفكوكة لسطورها دايمًا**. «٨٩» لوحده مايخلّيش موظف يقدر
 * يقرر — فإما بيتجاهل الشاشة أو بيعاقب حد بلا أساس، والاتنين أسوأ من عدم وجودها.
 */

const LEVEL_LABELS: Record<string, string> = {
  normal: 'عادي', watch: 'مراقبة', medium: 'متوسط', high: 'عالي', critical: 'حرج',
};
const LEVEL_CLASS: Record<string, string> = {
  normal: 'bg-slate-100 text-slate-700',
  watch: 'bg-amber-100 text-amber-800',
  medium: 'bg-orange-100 text-orange-800',
  high: 'bg-red-100 text-red-800',
  critical: 'bg-red-600 text-white',
};
const VERDICT_LABELS: Record<string, string> = {
  pending: 'لسه بلا حكم',
  legitimate: 'مشروعة',
  suspicious: 'مشبوهة',
  confirmed_abuse: 'تلاعب مؤكَّد',
  insufficient_evidence: 'دليل غير كافٍ',
};
const ACTION_LABELS: Record<string, string> = {
  monitor: 'متابعة',
  manual_review: 'مراجعة يدوية',
  reduce_matching_priority: 'خفض أولوية التوزيع',
  matching_hold: 'تعليق التوزيع مؤقتًا',
  suspend_account: 'تعليق الحساب',
  restore_account: 'إرجاع الحساب',
  clear_no_action: 'إغلاق بلا إجراء',
};
const CASE_STATUS_LABELS: Record<string, string> = {
  needs_review: 'محتاج مراجعة', monitoring: 'تحت المتابعة', investigating: 'تحقيق جارٍ',
  cleared: 'اتبرّأ', confirmed_manipulation: 'تلاعب مؤكَّد',
};

const TABS = ['overview', 'signals', 'orders', 'customers', 'history'] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  overview: 'نظرة عامة', signals: 'الإشارات', orders: 'الطلبات',
  customers: 'الأطراف المقابلة', history: 'سجل المراجعة',
};

type ScoreLine = {
  signalId: string; labelAr: string; bucket: string; baseWeight: number;
  ageDays: number; decayFactor: number; verdict: string; contribution: number;
  evidence: Record<string, unknown>; orderId: string | null;
};

/** الأنواع دي مطابقة لرد `RiskCenterService` — مفيش `any` في شاشة بتوصّل لتعليق حساب. */
type RiskSignalRow = {
  id: string; label_ar: string; description_ar: string; bucket: string;
  occurred_at: string; verdict: string; verdict_notes: string | null;
  reviewer_name: string | null; evidence: Record<string, unknown>;
  order_id: string | null; order_number: string | null;
};

type RiskOrderRow = {
  id: string; order_number: string; order_status: string; service_name: string;
  total_amount_cents: string | number; added_by_actor_cents: string | number;
  parts_without_receipt: number; has_complaint: boolean; has_refund: boolean;
};

type RiskCounterpartyRow = {
  counterparty_user_id: string; full_name: string; orders: number;
  cancelled: number; technician_cancellations: number; stopped_booking_after: boolean;
};

type ReviewHistoryRow = {
  id: string; label_ar: string; verdict: string; verdict_notes: string | null;
  reviewer_name: string | null; verdict_at: string | null;
};

type RiskActionRow = {
  id: string; action_type: string; reason: string; score_at_action: number;
  performed_by_name: string | null; created_at: string;
};

type RiskProfile = {
  actor: { user_id: string; full_name: string | null; phone_number: string | null;
           user_type: string; is_blocked: boolean; member_since: string };
  score: number;
  level: string;
  score_breakdown: ScoreLine[];
  bucket_totals: Record<string, number>;
  signal_count: number;
  dismissed_count: number;
  open_case: { id: string; status: string } | null;
  stats: Record<string, number>;
  timeline: { month: string; bucket: string; signals: number }[];
  review_history: ReviewHistoryRow[];
  actions: RiskActionRow[];
  suggested_action: { level: string; suggested: string; automatic: false };
};

export default function RiskProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { authedFetch } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = useAdminQuery<RiskProfile>(
    `risk-profile:${userId}`,
    () => authedFetch<RiskProfile>(`/admin/risk-center/actors/${userId}`),
    'تعذّر تحميل ملف المخاطر',
  );
  const signals = useAdminQuery<RiskSignalRow[]>(
    tab === 'signals' ? `risk-signals:${userId}` : null,
    () => authedFetch<RiskSignalRow[]>(`/admin/risk-center/actors/${userId}/signals`),
    'تعذّر تحميل الإشارات',
  );
  const orders = useAdminQuery<RiskOrderRow[]>(
    tab === 'orders' ? `risk-orders:${userId}` : null,
    () => authedFetch<RiskOrderRow[]>(`/admin/risk-center/actors/${userId}/orders`),
    'تعذّر تحميل الطلبات',
  );
  const counterparties = useAdminQuery<RiskCounterpartyRow[]>(
    tab === 'customers' ? `risk-parties:${userId}` : null,
    () => authedFetch<RiskCounterpartyRow[]>(`/admin/risk-center/actors/${userId}/customers`),
    'تعذّر تحميل الأطراف المقابلة',
  );

  async function submitVerdict(signalId: string, verdict: string, notes: string) {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/risk-center/signals/${signalId}/verdict`, {
        method: 'POST', body: JSON.stringify({ verdict, notes }),
      });
      signals.reload();
      profile.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تسجيل الحكم');
    } finally {
      setBusy(false);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/risk-center/actors/${userId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action_type: form.get('action_type'), reason: form.get('reason') }),
      });
      profile.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تنفيذ الإجراء');
    } finally {
      setBusy(false);
    }
  }

  async function submitCase(status: string) {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/risk-center/actors/${userId}/case`, {
        method: 'POST', body: JSON.stringify({ status, notes: `تحديث الحالة إلى ${CASE_STATUS_LABELS[status]}` }),
      });
      profile.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحديث الحالة');
    } finally {
      setBusy(false);
    }
  }

  const data = profile.data;
  const lines: ScoreLine[] = data?.score_breakdown ?? [];

  return (
    <AppShell>
      <Link href="/risk-center" className="mb-3 inline-flex items-center gap-1 text-sm underline">
        <ArrowRight className="h-4 w-4" />رجوع لمركز المخاطر
      </Link>

      {profile.loading && <p className="text-muted-foreground">جاري تحميل ملف المخاطر…</p>}
      {profile.error && <p className="text-destructive">{profile.error}</p>}

      {data && (
        <>
          <PageHeader
            title={data.actor?.full_name ?? 'ملف مخاطر'}
            description={`${data.actor?.user_type ?? ''} · عضو منذ ${new Date(data.actor?.member_since).toLocaleDateString('ar-EG')}`}
          />

          {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground">درجة المخاطر</p>
                <p className={`mx-auto mt-2 inline-flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold ${LEVEL_CLASS[data.level] ?? ''}`}>
                  {data.score}
                </p>
                <p className="mt-2 font-semibold">{LEVEL_LABELS[data.level]}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.signal_count} إشارة · {data.dismissed_count} اتشالت بعد المراجعة
                </p>
                {data.actor?.is_blocked && <Badge variant="destructive" className="mt-2">الحساب معلّق</Badge>}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">حالة المراجعة والإجراء</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  الحالة:{' '}
                  {data.open_case
                    ? <Badge variant="secondary">{CASE_STATUS_LABELS[data.open_case.status] ?? data.open_case.status}</Badge>
                    : <span className="text-muted-foreground">مفيش حالة مفتوحة</span>}
                </p>
                {/* **الاقتراح معلَّم صراحةً إنه اقتراح.** النظام مابينفّذش لوحده أبدًا. */}
                <p className="rounded-md bg-muted/50 p-2 text-sm">
                  النظام بيقترح: <strong>{ACTION_LABELS[data.suggested_action?.suggested] ?? '—'}</strong>
                  <span className="text-muted-foreground"> — اقتراح مش تنفيذ، القرار والتنفيذ للإنسان.</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {(['monitoring', 'investigating', 'cleared', 'confirmed_manipulation'] as const).map((status) => (
                    <Button key={status} size="sm" variant="outline" disabled={busy} onClick={() => submitCase(status)}>
                      {CASE_STATUS_LABELS[status]}
                    </Button>
                  ))}
                </div>
                <form onSubmit={submitAction} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
                  <div>
                    <Label className="text-xs">الإجراء</Label>
                    <SelectNative name="action_type" className="mt-1 h-9 w-full" defaultValue="manual_review">
                      {Object.entries(ACTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </SelectNative>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">السبب (١٠ حروف على الأقل)</Label>
                    <Input name="reason" minLength={10} maxLength={2000} required className="mt-1 h-9" />
                  </div>
                  <div className="flex items-end">
                    <Button size="sm" disabled={busy} className="w-full">نفّذ</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* ═══ التبويبات ═══ */}
          <div className="mb-4 flex flex-wrap gap-2 border-b">
            {TABS.map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`}
              >
                {TAB_LABELS[value]}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ليه النظام شايفه كده — الدرجة مفكوكة سطر بسطر</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {lines.length === 0 && <p className="text-sm text-muted-foreground">مفيش إشارات على الشخص ده.</p>}
                  {lines.map((line) => (
                    <div key={line.signalId} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          <span className={line.contribution > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                            {line.contribution > 0 ? `+${line.contribution}` : '0'}
                          </span>{' '}
                          {line.labelAr}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{BUCKET_LABELS[line.bucket] ?? line.bucket}</Badge>
                          <span>وزن {line.baseWeight}</span>
                          {/* عمر الإشارة وعامل اضمحلالها ظاهرين: «دي من شهرين فبتتحسب نص»
                              جملة مراجع يقدر يقولها لفني بيتعاقب. */}
                          <span>عمرها {line.ageDays} يوم × {line.decayFactor}</span>
                          <Badge variant={line.verdict === 'legitimate' ? 'secondary' : 'outline'}>
                            {VERDICT_LABELS[line.verdict]}
                          </Badge>
                        </span>
                      </div>
                      <EvidenceLine evidence={line.evidence} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">أرقامه في آخر ٩٠ يوم</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Stat label="طلبات" value={data.stats?.orders_90d} />
                  <Stat label="مكتملة" value={data.stats?.completed} />
                  <Stat label="ملغية" value={data.stats?.cancelled} />
                  <Stat label="إلغاءات منه" value={data.stats?.technician_cancellations} />
                  <Stat label="شكاوى ضده" value={data.stats?.complaints_against} />
                  <Stat label="شكاوى قدّمها" value={data.stats?.complaints_filed} />
                  <Stat label="استردادات" value={data.stats?.refunds} />
                  <Stat label="متوسط التقييم" value={data.stats?.avg_rating} />
                  <Stat label="إجمالي الطلبات" value={formatEgp(Number(data.stats?.gross_cents ?? 0))} />
                </CardContent>
              </Card>

              {(data.timeline?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">خط زمني للسلوك — بيتدهور ولا بيتحسّن؟</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Object.entries(
                      data.timeline
                        .reduce<Record<string, { bucket: string; signals: number }[]>>((acc, row) => {
                          (acc[row.month] ??= []).push({ bucket: row.bucket, signals: row.signals });
                          return acc;
                        }, {}),
                    ).map(([month, rows]) => (
                      <div key={month} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
                        <span className="w-20 font-mono text-sm">{month}</span>
                        {rows.map((row) => (
                          <Badge key={row.bucket} variant="outline">
                            {BUCKET_LABELS[row.bucket] ?? row.bucket}: {row.signals}
                          </Badge>
                        ))}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {tab === 'signals' && (
            <Card>
              <CardHeader><CardTitle className="text-base">كل الإشارات — والحكم عليها</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {signals.loading && <p className="text-muted-foreground">جاري التحميل…</p>}
                {(signals.data?.length ?? 0) === 0 && !signals.loading && (
                  <p className="text-sm text-muted-foreground">مفيش إشارات.</p>
                )}
                {signals.data?.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} busy={busy} onVerdict={submitVerdict} />
                ))}
              </CardContent>
            </Card>
          )}

          {tab === 'orders' && (
            <Card>
              <CardHeader><CardTitle className="text-base">طلباته</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الطلب</TableHead><TableHead>الخدمة</TableHead><TableHead>الحالة</TableHead>
                      <TableHead>الإجمالي</TableHead><TableHead>اللي ضافه هو</TableHead>
                      <TableHead>قطع بلا إيصال</TableHead><TableHead>شكوى/استرداد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.data?.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/orders/${order.id}`} className="underline">{order.order_number}</Link>
                        </TableCell>
                        <TableCell>{order.service_name}</TableCell>
                        <TableCell>{order.order_status}</TableCell>
                        <TableCell>{formatEgp(Number(order.total_amount_cents))}</TableCell>
                        <TableCell className={Number(order.added_by_actor_cents) > 0 ? 'font-semibold text-destructive' : ''}>
                          {formatEgp(Number(order.added_by_actor_cents))}
                        </TableCell>
                        <TableCell>{Number(order.parts_without_receipt) > 0 ? `${order.parts_without_receipt} ⚠️` : '—'}</TableCell>
                        <TableCell className="text-xs">
                          {order.has_complaint ? 'شكوى ' : ''}{order.has_refund ? 'استرداد' : ''}
                          {!order.has_complaint && !order.has_refund ? '—' : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {tab === 'customers' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">الأطراف المقابلة</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>العميل</TableHead><TableHead>طلبات</TableHead><TableHead>ملغية</TableHead>
                      <TableHead>إلغاءات منه هو</TableHead><TableHead>وقف يحجز بعدها؟</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {counterparties.data?.map((row) => (
                      <TableRow key={row.counterparty_user_id}>
                        <TableCell>{row.full_name}</TableCell>
                        <TableCell>{row.orders}</TableCell>
                        <TableCell>{row.cancelled}</TableCell>
                        <TableCell>{row.technician_cancellations}</TableCell>
                        <TableCell>
                          {/* مؤشر التسريب — **مش اتهام**. عميل ممكن يبطّل يستخدم المنصة لأي سبب. */}
                          {row.stopped_booking_after
                            ? <Badge variant="outline" className="text-amber-800">وقف يحجز</Badge>
                            : <span className="text-muted-foreground">لسه بيحجز</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {tab === 'history' && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">أحكام المراجعين</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(data.review_history?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">مفيش أحكام لسه.</p>
                  )}
                  {data.review_history?.map((row) => (
                    <div key={row.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{row.label_ar}</span>
                        <Badge variant="outline">{VERDICT_LABELS[row.verdict] ?? row.verdict}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">{row.verdict_notes}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.reviewer_name} · {row.verdict_at ? new Date(row.verdict_at).toLocaleString('ar-EG') : ''}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">الإجراءات المتّخذة</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(data.actions?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground">مفيش إجراءات.</p>
                  )}
                  {data.actions?.map((row) => (
                    <div key={row.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{ACTION_LABELS[row.action_type] ?? row.action_type}</span>
                        <span className="text-xs text-muted-foreground">الدرجة وقتها: {row.score_at_action}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{row.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.performed_by_name} · {new Date(row.created_at).toLocaleString('ar-EG')}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{String(value ?? 0)}</p>
    </div>
  );
}

/**
 * الدليل الرقمي بيتعرض **كما هو**، والمقارنة بالأقران بتتصاغ كجملة مقروءة.
 *
 * «زوّد السعر في ٦١٪» مش رقم له معنى لوحده. «وأقرانه ٩٪» هو اللي بيخلّيه شذوذ.
 */
function EvidenceLine({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence ?? {}).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;

  const measured = evidence.measured_pct ?? evidence.refund_pct ?? evidence.complaint_pct ?? evidence.concentration_pct;
  const peer = evidence.peer_median_pct;

  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {measured !== undefined && peer !== undefined && (
        <p className="font-medium text-foreground">
          المقاس {String(measured)}% · وسيط الأقران {String(peer)}%
          {evidence.peer_count ? ` (من ${String(evidence.peer_count)} قرين)` : ''}
        </p>
      )}
      <p className="break-words">
        {entries
          .filter(([key]) => !['measured_pct', 'peer_median_pct', 'peer_count'].includes(key))
          .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
          .join(' · ')}
      </p>
    </div>
  );
}

function SignalCard({
  signal, busy, onVerdict,
}: {
  signal: RiskSignalRow;
  busy: boolean;
  onVerdict: (signalId: string, verdict: string, notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState('legitimate');
  const [notes, setNotes] = useState('');

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{signal.label_ar}</span>
        <span className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{BUCKET_LABELS[signal.bucket] ?? signal.bucket}</Badge>
          <Badge variant={signal.verdict === 'pending' ? 'default' : 'secondary'}>
            {VERDICT_LABELS[signal.verdict] ?? signal.verdict}
          </Badge>
          <span className="text-muted-foreground">{new Date(signal.occurred_at).toLocaleDateString('ar-EG')}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{signal.description_ar}</p>
      <EvidenceLine evidence={signal.evidence} />
      {signal.order_number && (
        <Link href={`/orders/${signal.order_id}`} className="mt-1 inline-block text-xs underline">
          الطلب {signal.order_number}
        </Link>
      )}
      {signal.verdict_notes && (
        <p className="mt-2 rounded bg-muted/50 p-2 text-xs">
          حكم {signal.reviewer_name}: {signal.verdict_notes}
        </p>
      )}

      {!open && (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
          {signal.verdict === 'pending' ? 'سجّل حكم' : 'غيّر الحكم'}
        </Button>
      )}
      {open && (
        <div className="mt-2 grid gap-2 rounded-md border p-2 sm:grid-cols-3">
          <SelectNative value={verdict} onChange={(e) => setVerdict(e.target.value)} className="h-9">
            {Object.entries(VERDICT_LABELS).filter(([key]) => key !== 'pending').map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectNative>
          <Input
            placeholder="السبب (١٠ حروف على الأقل)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-9 sm:col-span-2"
          />
          <div className="flex gap-2 sm:col-span-3">
            <Button size="sm" disabled={busy || notes.trim().length < 10} onClick={() => { onVerdict(signal.id, verdict, notes); setOpen(false); }}>
              احفظ الحكم
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
          </div>
        </div>
      )}
    </div>
  );
}
