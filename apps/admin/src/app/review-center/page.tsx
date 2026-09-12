'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ScanSearch } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

/**
 * **مركز المراجعة والشواذ** (ADR-0084، طلب مالك docs/08 §139).
 *
 * الشاشة دي بتجاوب سؤال واحد: **«مين عمل حاجة محتاجة مراجعة، وإيه اللي كتبه؟»**
 *
 * مختلفة عمدًا عن `/operations` (حاجة **واقفة** محتاجة تحريك) وعن `/security-center` (أحداث
 * صلاحيات). خلطهم كان هيخلي «الأدمن بيبص فين؟» سؤال ليه تلات إجابات.
 *
 * **القاعدة الحاكمة في العرض**: النص اللي الفني كتبه بيتعرض **كامل**، مش مقصوص ولا مطوي وراء
 * زرار. المالك طلب الشاشة دي بالنص عشان «يدوّر ورا الصنايعية ويشوف إيه اللي فيه تلاعب» — وده
 * مابيحصلش من رقم.
 */

interface MoneyActionRow {
  kind: 'order_item' | 'quote';
  id: string;
  order_id: string;
  order_number: string;
  action_type: string;
  status: string;
  is_pending: boolean;
  amount_cents: number;
  name_ar: string | null;
  justification: string | null;
  scope_included: string | null;
  scope_excluded: string | null;
  revision_reason: string | null;
  justification_missing: boolean;
  technician_id: string | null;
  technician_name: string | null;
  created_at: string;
}

interface FailedVisitRow {
  order_id: string;
  order_number: string;
  technician_name: string | null;
  customer_name: string | null;
  reason_category: string | null;
  description: string | null;
  reported_at: string;
  scheduled_at: string | null;
  total_amount_cents: number;
}

interface CashDisputeRow {
  order_id: string;
  order_number: string;
  technician_name: string | null;
  customer_name: string | null;
  total_amount_cents: number;
  customer_cash_confirmed_at: string | null;
  technician_cash_not_received_at: string | null;
  is_conflict: boolean;
  order_status: string;
}

interface ComplaintRow {
  complaint_id: string;
  complaint_number: string;
  order_id: string | null;
  order_number: string | null;
  category: string;
  severity: string;
  title: string;
  filed_by_name: string | null;
  filed_by_type: string | null;
  against_name: string | null;
  against_type: string | null;
  sla_due_at: string;
  is_overdue: boolean;
}

interface ReviewCenterResponse {
  technician_money_actions: { items: MoneyActionRow[]; total: number; pending: number };
  failed_visits: { items: FailedVisitRow[]; total: number };
  cash_disputes: { items: CashDisputeRow[]; total: number; conflicts: number };
  unresolved_complaints: { items: ComplaintRow[]; total: number; overdue: number };
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  spare_part: 'قطعة غيار',
  extra_labor: 'أجر إضافي',
  addon: 'إضافة',
  technician_onsite: 'عرض سعر بعد معاينة',
  technician_diagnosis: 'عرض سعر بعد تشخيص',
  admin_remote: 'عرض سعر من الإدارة',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'مستني رد العميل',
  approved: 'اتوافق عليه',
  declined: 'اترفض',
  pending_admin_review: 'مستني مراجعة الإدارة',
  pending_customer: 'مستني رد العميل',
  rejected: 'اترفض',
  expired: 'انتهت صلاحيته',
  superseded: 'اتستبدل بنسخة أحدث',
};

const FAILED_VISIT_REASON_LABELS: Record<string, string> = {
  no_show: 'العميل مش موجود',
  required_work_rejected: 'العميل رفض الشغل المطلوب',
  other: 'سبب آخر',
};

const USER_TYPE_LABELS: Record<string, string> = {
  customer: 'عميل',
  technician: 'فني',
  admin: 'موظف',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'حرج',
  high: 'عالي',
  medium: 'متوسط',
  low: 'منخفض',
};

const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ar-EG-u-nu-latn') : '—');

/** نص الفني بيتعرض كتلة كاملة محافظة على سطوره — مش سطر واحد مقصوص. */
function Justification({ text, missing }: { text: string | null; missing: boolean }) {
  if (missing || !text) {
    return (
      <span className="text-sm text-destructive">
        بلا تبرير مكتوب — الصف ده اتسجّل قبل ما التبرير يبقى إجباري
      </span>
    );
  }
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>;
}

function SectionCard({
  title,
  description,
  count,
  badge,
  children,
}: {
  title: string;
  description: string;
  count: number;
  badge?: { label: string; tone: 'danger' | 'warning' } | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {title} ({count})
          </CardTitle>
          {badge && (
            <Badge variant={badge.tone === 'danger' ? 'destructive' : 'secondary'}>{badge.label}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ReviewCenterPage() {
  const { authedFetch, isLoading } = useAuth();
  const [pendingOnly, setPendingOnly] = useState(false);
  const [sinceDays, setSinceDays] = useState(30);

  const query = useMemo(() => {
    const params = new URLSearchParams({ since_days: String(sinceDays) });
    if (pendingOnly) params.set('pending_only', 'true');
    return `?${params.toString()}`;
  }, [pendingOnly, sinceDays]);

  // `useAdminQuery` هو نفس الهوك اللي كل صفحات الأدمن بتستخدمه — بيعمل الجلب الأولي وإعادة
  // التحميل ويتعامل مع الإلغاء، من غير `setState` متزامن جوّه effect (اللي اللينت بيمنعه بحق).
  //
  // **المفتاح `null` طول ما التوكن لسه بيتحمّل** — ده مش تجميل: من غيره الصفحة بتنادي الـAPI
  // قبل ما التوكن يجهز فبتاخد 401، والمفتاح ثابت فمفيش إعادة محاولة لما يجهز ⇒ صفحة فاضية
  // للأبد. نفس البَقّة اللي `scripts/sweep-admin.js` اتعمل عشانها أصلاً (بَقّة warranty-plans)،
  // ومسكها هنا في أول تشغيلة على الصفحة دي.
  const { data, error, reload } = useAdminQuery(
    isLoading ? null : query,
    () => authedFetch<ReviewCenterResponse>(`/admin/operations/review-center${query}`),
    'حصل خطأ في تحميل مركز المراجعة',
  );

  // نفس فلسفة مركز الاستثناءات: كل بند هنا محتاج قرار، فالشاشة لازم تكون حيّة.
  // الطلبات (أفعال مالية/نشو/كاش) والدعم (الشكاوى) هما المصدرين اللي بيحرّكوا الأقسام الأربعة.
  useAdminLiveRefresh(['orders', 'support'], reload);

  return (
    <AppShell>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5" aria-hidden="true" />
            مركز المراجعة
          </span>
        }
        description="كل حاجة خرجت عن المسار العادي ومحتاجة حكم بشري — أفعال الفني المالية، النشو، الكاش اللي ماوصلش، والشكاوى المفتوحة."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">المدى الزمني</span>
          <SelectNative value={String(sinceDays)} onChange={(e) => setSinceDays(Number(e.target.value))}>
            <option value="7">آخر ٧ أيام</option>
            <option value="30">آخر ٣٠ يوم</option>
            <option value="90">آخر ٩٠ يوم</option>
            <option value="365">آخر سنة</option>
          </SelectNative>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          <span>المعلّق بس (محتاج قرار دلوقتي)</span>
        </label>
      </div>

      {error && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!data ? (
        <TableSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── أفعال الفني المالية ──────────────────────────────────────── */}
          <SectionCard
            title="أفعال الفني المالية"
            description="كل مرة الفني زوّد فلوس الطلب: قطعة غيار، أجر إضافي، أو عرض سعر بعد معاينة — بالنص اللي كتبه بالحرف."
            count={data.technician_money_actions.total}
            badge={
              data.technician_money_actions.pending > 0
                ? { label: `${data.technician_money_actions.pending} مستني قرار`, tone: 'warning' }
                : null
            }
          >
            {data.technician_money_actions.items.length === 0 ? (
              <EmptyState title="مفيش أفعال مالية في المدى ده" />
            ) : (
              <div className="flex flex-col gap-3">
                {data.technician_money_actions.items.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.kind === 'quote' ? 'default' : 'outline'}>
                        {ACTION_TYPE_LABELS[item.action_type] ?? item.action_type}
                      </Badge>
                      <span className="font-semibold">{formatEgp(item.amount_cents)}</span>
                      {item.name_ar && <span className="text-sm">· {item.name_ar}</span>}
                      <Badge variant={item.is_pending ? 'secondary' : 'outline'}>
                        {STATUS_LABELS[item.status] ?? item.status}
                      </Badge>
                      {item.justification_missing && <Badge variant="destructive">بلا تبرير</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <Link href={`/orders/${item.order_id}`} className="text-primary hover:underline">
                        {item.order_number}
                      </Link>
                      <span>الفني: {item.technician_name ?? '—'}</span>
                      <span>{formatDateTime(item.created_at)}</span>
                    </div>
                    <div className="mt-3 rounded-md bg-muted/40 p-3">
                      <Justification text={item.justification} missing={item.justification_missing} />
                      {item.scope_included && (
                        <p className="mt-2 text-xs">
                          <span className="font-medium">شامل:</span> {item.scope_included}
                        </p>
                      )}
                      {item.scope_excluded && (
                        <p className="mt-1 text-xs">
                          <span className="font-medium">مش شامل:</span> {item.scope_excluded}
                        </p>
                      )}
                      {item.revision_reason && (
                        <p className="mt-1 text-xs">
                          <span className="font-medium">سبب تعديل العرض:</span> {item.revision_reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ── النشو ────────────────────────────────────────────────────── */}
          <SectionCard
            title="زيارات فاشلة (نشو)"
            description="الفني راح ومفيش شغل اتعمل — بسبب البلاغ ونص الفني، ومستنية قرار إداري (إعادة جدولة أو إلغاء برسوم)."
            count={data.failed_visits.total}
            badge={data.failed_visits.total > 0 ? { label: 'محتاجة قرار', tone: 'danger' } : null}
          >
            {data.failed_visits.items.length === 0 ? (
              <EmptyState title="مفيش زيارات فاشلة في المدى ده" />
            ) : (
              <div className="flex flex-col gap-3">
                {data.failed_visits.items.map((visit) => (
                  <div key={visit.order_id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${visit.order_id}`} className="font-medium text-primary hover:underline">
                        {visit.order_number}
                      </Link>
                      <Badge variant="destructive">
                        {visit.reason_category ? (FAILED_VISIT_REASON_LABELS[visit.reason_category] ?? visit.reason_category) : 'بلا تصنيف'}
                      </Badge>
                      <span className="text-sm">{formatEgp(visit.total_amount_cents)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>الفني: {visit.technician_name ?? '—'}</span>
                      <span>العميل: {visit.customer_name ?? '—'}</span>
                      <span>الموعد: {formatDateTime(visit.scheduled_at)}</span>
                      <span>البلاغ: {formatDateTime(visit.reported_at)}</span>
                    </div>
                    <div className="mt-3 rounded-md bg-muted/40 p-3">
                      <Justification text={visit.description} missing={!visit.description} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ── الكاش ────────────────────────────────────────────────────── */}
          <SectionCard
            title="كاش ماوصلش"
            description="الفني بلّغ إنه ماستلمش الكاش. لو العميل مؤكّد إنه سلّم، ده تضارب صريح محدش غير الإدارة يقدر يحسمه."
            count={data.cash_disputes.total}
            badge={
              data.cash_disputes.conflicts > 0 ? { label: `${data.cash_disputes.conflicts} تضارب صريح`, tone: 'danger' } : null
            }
          >
            {data.cash_disputes.items.length === 0 ? (
              <EmptyState title="مفيش بلاغات كاش في المدى ده" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الطلب</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الفني</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>بلاغ الفني</TableHead>
                    <TableHead>تأكيد العميل</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cash_disputes.items.map((row) => (
                    <TableRow key={row.order_id}>
                      <TableCell>
                        <Link href={`/orders/${row.order_id}`} className="text-primary hover:underline">
                          {row.order_number}
                        </Link>
                      </TableCell>
                      <TableCell>{formatEgp(row.total_amount_cents)}</TableCell>
                      <TableCell>{row.technician_name ?? '—'}</TableCell>
                      <TableCell>{row.customer_name ?? '—'}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(row.technician_cash_not_received_at)}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(row.customer_cash_confirmed_at)}</TableCell>
                      <TableCell>
                        {row.is_conflict ? (
                          <Badge variant="destructive">تضارب صريح</Badge>
                        ) : (
                          <Badge variant="secondary">بلاغ من طرف واحد</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          {/* ── الشكاوى ──────────────────────────────────────────────────── */}
          <SectionCard
            title="شكاوى مفتوحة"
            description="الشكاوى اللي لسه بلا حسم — بمقدّمها والمشكو في حقه بالاسم."
            count={data.unresolved_complaints.total}
            badge={
              data.unresolved_complaints.overdue > 0
                ? { label: `${data.unresolved_complaints.overdue} متخطية المهلة`, tone: 'danger' }
                : null
            }
          >
            {data.unresolved_complaints.items.length === 0 ? (
              <EmptyState title="مفيش شكاوى مفتوحة في المدى ده" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الشكوى</TableHead>
                    <TableHead>الموضوع</TableHead>
                    <TableHead>من</TableHead>
                    <TableHead>على</TableHead>
                    <TableHead>الخطورة</TableHead>
                    <TableHead>المهلة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unresolved_complaints.items.map((row) => (
                    <TableRow key={row.complaint_id}>
                      <TableCell>
                        <Link href="/support" className="text-primary hover:underline">
                          {row.complaint_number}
                        </Link>
                        {row.order_id && (
                          <>
                            {' · '}
                            <Link href={`/orders/${row.order_id}`} className="text-xs text-primary hover:underline">
                              {row.order_number}
                            </Link>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[18rem]">{row.title}</TableCell>
                      <TableCell className="text-xs">
                        {row.filed_by_name ?? '—'}
                        {row.filed_by_type && (
                          <span className="text-muted-foreground"> ({USER_TYPE_LABELS[row.filed_by_type] ?? row.filed_by_type})</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.against_name ?? <span className="text-muted-foreground">على المنصة</span>}
                        {row.against_type && (
                          <span className="text-muted-foreground"> ({USER_TYPE_LABELS[row.against_type] ?? row.against_type})</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.severity === 'critical' || row.severity === 'high' ? 'destructive' : 'secondary'}>
                          {SEVERITY_LABELS[row.severity] ?? row.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(row.sla_due_at)}
                        {row.is_overdue && <Badge variant="destructive" className="mr-2">متأخرة</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      )}
    </AppShell>
  );
}
