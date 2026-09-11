'use client';

import { useEffect, useState } from 'react';
import type { AdminRefundResponseDto, RefundStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { REFUND_METHOD_LABELS, REFUND_STATUS_LABELS } from '@/lib/payments-labels';

/**
 * **صفحة متابعة الاستردادات** (طلب مالك 2026-09-11).
 *
 * > «لما الاسترداد بيتقبل تلقائيًا من النظام — وده المسار الصح — لازم يبان للأدمن عشان يتابع.»
 *
 * `GET /admin/refunds` كان موجود في الـAPI من زمان (اتعمل تحديدًا عشان الأدمن يلاقي الاستردادات
 * العالقة)، بس **مفيش أي حاجة في لوحة الأدمن كانت بتناديه**. الطريقة الوحيدة لرؤية استرداد كانت
 * إنك تفتح الطلب اللي **تشك فيه أصلاً** — يعني استرداد النظام التلقائي كان عمليًا غير مرئي.
 *
 * الفلتر الافتراضي «محتاج متابعة» عمدًا: أول حاجة تتفتح لازم تكون الفلوس المعلّقة في النص.
 */

type Tab = 'needs_work' | 'automatic' | 'all' | RefundStatus;

const TABS: { value: Tab; label: string; hint?: string }[] = [
  { value: 'needs_work', label: 'محتاج متابعة', hint: 'فلوس معلّقة: البوابة ما ردّتش، ومحتاجة تثبيت نتيجة يدوي' },
  { value: 'automatic', label: 'تلقائي من النظام', hint: 'استردادات النظام عملها لوحده على طلبات اتلغت وهي مدفوعة' },
  { value: 'completed', label: 'مكتملة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'all', label: 'الكل' },
];

function queryFor(tab: Tab): string {
  if (tab === 'needs_work') return '?needs_reconciliation=true';
  if (tab === 'automatic') return '?automatic=true';
  if (tab === 'all') return '';
  return `?status=${tab}`;
}

function statusTone(refund: AdminRefundResponseDto): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (refund.needs_reconciliation) return 'warning';
  if (refund.refund_status === 'completed') return 'success';
  if (refund.refund_status === 'rejected') return 'danger';
  if (refund.refund_status === 'processing') return 'warning';
  return 'neutral';
}

export default function RefundsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [refunds, setRefunds] = useState<AdminRefundResponseDto[] | null>(null);
  const [tab, setTab] = useState<Tab>('needs_work');
  const [error, setError] = useState<string | null>(null);

  // التنضيف بيحصل جوّه `.then` مش قبل النداء: أي `setState` متزامن جوّه جسم الـeffect
  // بيولّد render متتالي (`react-hooks/set-state-in-effect`)، ومفيش داعي ليه هنا أصلاً.
  function load() {
    authedFetch<AdminRefundResponseDto[]>(`/admin/refunds${queryFor(tab)}`)
      .then((rows) => {
        setRefunds(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الاستردادات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, tab]);

  useAdminLiveRefresh(['payments', 'orders'], () => load());

  const activeTab = TABS.find((item) => item.value === tab);

  return (
    <AppShell>
      <PageHeader title="الاستردادات" />

      <div className="mb-2 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={tab === item.value ? 'default' : 'outline'}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {activeTab?.hint && <p className="mb-4 text-sm text-muted-foreground">{activeTab.hint}</p>}

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!error && !refunds && <TableSkeleton columns={7} />}
      {refunds && refunds.length === 0 && (
        <EmptyState
          title={tab === 'needs_work' ? 'مفيش أي فلوس معلّقة' : 'مفيش استردادات مطابقة'}
        />
      )}

      {refunds && refunds.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الاسترداد</TableHead>
              <TableHead>الطلب</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الطريقة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>مين عمله</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunds.map((refund) => (
              <TableRow key={refund.id}>
                <TableCell dir="ltr">{refund.refund_number}</TableCell>
                <TableCell>
                  {refund.order_id ? (
                    <a className="underline underline-offset-4" href={`/orders/${refund.order_id}`}>
                      {refund.order_number ?? 'فتح الطلب'}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{formatEgp(refund.amount_cents)}</TableCell>
                <TableCell>{REFUND_METHOD_LABELS[refund.refund_method]}</TableCell>
                <TableCell>
                  <StatusChip tone={statusTone(refund)}>
                    {refund.needs_reconciliation ? 'مستني تثبيت النتيجة' : REFUND_STATUS_LABELS[refund.refund_status]}
                  </StatusChip>
                  {refund.reason_notes && (
                    <span className="block text-xs text-muted-foreground">{refund.reason_notes}</span>
                  )}
                </TableCell>
                <TableCell>
                  {refund.is_automatic ? (
                    <StatusChip tone="info">النظام تلقائيًا</StatusChip>
                  ) : (
                    <span className="text-muted-foreground">الإدارة</span>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(refund.requested_at).toLocaleString('ar-EG-u-nu-latn')}
                  {refund.completed_at && (
                    <span className="block text-xs text-muted-foreground">
                      اكتمل: {new Date(refund.completed_at).toLocaleString('ar-EG-u-nu-latn')}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
