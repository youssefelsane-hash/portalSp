'use client';

import { useEffect, useState } from 'react';
import type { InstaPayPendingPaymentResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { PromptDialog } from '@/components/prompt-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import Link from 'next/link';

// طابور تأكيد InstaPay الإداري (§28) — كانت فجوة حقيقية: confirm/reject-instapay موجودين من زمان
// جوّه apps/orders/[id]/page.tsx بس مفيش شاشة تجمّع الدفعات المعلّقة في مكان واحد — موظف Finance
// كان لازم يدوّر طلب-طلب. نفس أسلوب /payouts بالحرف (طابور + موافقة/رفض).
export default function InstaPayConfirmationsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [payments, setPayments] = useState<InstaPayPendingPaymentResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<{ items: InstaPayPendingPaymentResponseDto[] }>('/admin/payments/instapay-pending')
      .then((res) => setPayments(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الدفعات المعلّقة'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["payments"], () => load());

  async function runAction(action: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirm(id: string) {
    await runAction(() => authedFetch(`/admin/payments/${id}/confirm-instapay`, { method: 'POST' }));
  }

  async function handleReject(id: string, reason: string) {
    await runAction(() => authedFetch(`/admin/payments/${id}/reject-instapay`, { method: 'POST', body: JSON.stringify({ reason }) }));
  }

  return (
    <AppShell>
      <PageHeader
        title="تأكيدات InstaPay"
        description={
          'الدفعات المعلّقة اللي محتاجة مراجعة يدوية — اللي العميل بلّغ التحويل فيها ظاهرة الأول. ' +
          'رقم الطلب في العمود الأول هو نفس الكود اللي العميل مكتوب له صراحةً إنه يحطّه في ملاحظة ' +
          'تحويل InstaPay — قارنه مباشرة بملاحظة التحويل الفعلية في كشف الحساب قبل ما تأكّد.'
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!error && !payments && <TableSkeleton columns={6} />}
      {payments && payments.length === 0 && <EmptyState title="مفيش دفعات InstaPay معلّقة دلوقتي" />}

      {payments && payments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الطلب</TableHead>
              <TableHead>العميل</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الوقت</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>
                  <Link href={`/orders/${payment.order_id}`} className="underline" dir="ltr">
                    {payment.order_number}
                  </Link>
                </TableCell>
                <TableCell>
                  {payment.customer_name}
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    {payment.customer_phone}
                  </span>
                </TableCell>
                <TableCell>{formatEgp(payment.amount_cents)}</TableCell>
                <TableCell>
                  {payment.customer_confirmed_transfer_at ? (
                    <StatusChip tone="warning">العميل بلّغ التحويل</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">مستنّي العميل يبلّغ</StatusChip>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(payment.customer_confirmed_transfer_at ?? payment.initiated_at).toLocaleString('ar-EG-u-nu-latn')}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={isSaving} onClick={() => handleConfirm(payment.id)}>
                      تأكيد الاستلام
                    </Button>
                    <PromptDialog
                      trigger={
                        <Button size="sm" variant="destructive" disabled={isSaving}>
                          رفض
                        </Button>
                      }
                      title="رفض دفعة InstaPay"
                      label="سبب الرفض"
                      minLength={2}
                      confirmLabel="رفض"
                      destructive
                      onConfirm={(reason) => handleReject(payment.id, reason)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
