'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { KpiDimensionScores, TechnicianKpiSnapshotResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatEgp } from '@/lib/format';
import { KPI_STATUS_LABELS, KPI_STATUS_BADGE_VARIANT } from '@/lib/technician-kpi-labels';

const DIMENSION_LABELS_AR: Record<keyof KpiDimensionScores, string> = {
  rating: 'متوسط التقييم',
  cancellation: 'الإلغاء (سلبي)',
  complaints: 'الشكاوى (سلبي)',
  acceptance: 'قبول الطلبات',
  completion: 'إتمام الطلبات',
  revenue: 'الإيراد النسبي',
};

export default function TechnicianKpiDetailPage() {
  const params = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const [snapshot, setSnapshot] = useState<TechnicianKpiSnapshotResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [approvedAmount, setApprovedAmount] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');

  function load() {
    authedFetch<TechnicianKpiSnapshotResponseDto>(`/admin/technician-kpi/${params.id}`)
      .then((s) => {
        setSnapshot(s);
        setApprovedAmount(String(((s.suggested_bonus_cents ?? 0) / 100).toFixed(2)));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل السنابشوت'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, params.id]);

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

  async function handleApprove() {
    const cents = Math.round(Number(approvedAmount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      window.alert('المبلغ غير صحيح');
      return;
    }
    await runAction(() =>
      authedFetch(`/admin/technician-kpi/${params.id}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ approved_bonus_cents: cents, notes: approvalNotes || undefined }),
      }),
    );
  }

  async function handleReject() {
    const reason = window.prompt('سبب الرفض (5 حروف على الأقل)؟');
    if (reason === null) return;
    if (reason.trim().length < 5) {
      window.alert('السبب قصير جداً');
      return;
    }
    await runAction(() =>
      authedFetch(`/admin/technician-kpi/${params.id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
    );
  }

  async function handlePay() {
    await runAction(() => authedFetch(`/admin/technician-kpi/${params.id}/pay`, { method: 'POST' }));
  }

  if (error && !snapshot) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }
  if (!snapshot) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  const dimensionEntries = Object.entries(snapshot.dimension_scores) as [keyof KpiDimensionScores, number][];
  const isLocked = snapshot.status === 'approved' || snapshot.status === 'paid';

  return (
    <AppShell>
      <PageHeader
        title={`KPI الفني — ${snapshot.period_month}/${snapshot.period_year}`}
        description={
          <Link href={`/technicians/${snapshot.technician_id}`} className="underline-offset-2 hover:underline">
            عرض ملف الفني
          </Link>
        }
        actions={<Badge variant={KPI_STATUS_BADGE_VARIANT[snapshot.status]}>{KPI_STATUS_LABELS[snapshot.status]}</Badge>}
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الدرجة الكلية والأبعاد</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-3xl font-bold">{snapshot.overall_score ?? '—'} / 100</p>
            {snapshot.serious_upheld_complaint && (
              <p className="mb-4 text-sm text-destructive">شكوى حرجة مثبتة الشهر ده صفّرت الدرجة تلقائيًا.</p>
            )}
            {!snapshot.is_eligible && (
              <p className="mb-4 text-sm text-muted-foreground">غير مؤهّل تلقائيًا: {snapshot.ineligibility_reason}</p>
            )}
            <div className="space-y-2">
              {dimensionEntries.map(([key, score]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span>{DIMENSION_LABELS_AR[key]}</span>
                  <span className="font-medium">{score}</span>
                </div>
              ))}
              {dimensionEntries.length === 0 && <p className="text-sm text-muted-foreground">مفيش بيانات كافية لأي بُعد الشهر ده</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات الخام</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">طلبات مكتملة</span>
            <span>{snapshot.completed_orders_count}</span>
            <span className="text-muted-foreground">طلبات مقبولة</span>
            <span>{snapshot.accepted_orders_count}</span>
            <span className="text-muted-foreground">عروض اتبعتت</span>
            <span>{snapshot.offered_orders_count}</span>
            <span className="text-muted-foreground">إلغاء من الفني</span>
            <span>{snapshot.technician_cancelled_count}</span>
            <span className="text-muted-foreground">متوسط التقييم</span>
            <span>
              {snapshot.average_rating ?? '—'} ({snapshot.ratings_count} تقييم، {snapshot.negative_ratings_count} سلبي)
            </span>
            <span className="text-muted-foreground">شكاوى (مثبتة)</span>
            <span>
              {snapshot.complaints_count} ({snapshot.complaints_upheld_count} مثبتة)
            </span>
            <span className="text-muted-foreground">إعادة زيارة</span>
            <span>{snapshot.revisit_count}</span>
            <span className="text-muted-foreground">إيراد المنصة</span>
            <span>{formatEgp(snapshot.platform_revenue_cents)}</span>
            <span className="text-muted-foreground">أرباح الفني</span>
            <span>{formatEgp(snapshot.technician_earnings_cents)}</span>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">القرار والصرف</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">المبلغ المقترح آليًا</p>
                <p className="text-lg font-semibold">
                  {snapshot.suggested_bonus_cents !== null ? formatEgp(snapshot.suggested_bonus_cents) : '—'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">المبلغ المعتمد</p>
                <p className="text-lg font-semibold">
                  {snapshot.approved_bonus_cents !== null ? formatEgp(snapshot.approved_bonus_cents) : '—'}
                </p>
              </div>
            </div>

            {snapshot.status === 'calculated' || snapshot.status === 'rejected' ? (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <Label htmlFor="approved_amount">مبلغ المكافأة المعتمد (ج.م.)</Label>
                  <Input
                    id="approved_amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={approvedAmount}
                    onChange={(e) => setApprovedAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="approval_notes">ملاحظات (اختياري)</Label>
                  <Input id="approval_notes" value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={isSaving} onClick={handleApprove}>
                    اعتماد المبلغ
                  </Button>
                  <Button variant="destructive" disabled={isSaving} onClick={handleReject}>
                    رفض المكافأة الشهر ده
                  </Button>
                </div>
              </div>
            ) : null}

            {snapshot.status === 'approved' && (
              <div className="border-t pt-4">
                <ConfirmDialog
                  trigger={<Button disabled={isSaving}>صرف المكافأة من المحفظة</Button>}
                  title="تأكيد صرف المكافأة المعتمدة فعليًا من محفظة المنصة؟"
                  confirmLabel="صرف"
                  destructive={false}
                  onConfirm={handlePay}
                />
              </div>
            )}

            {snapshot.status === 'paid' && (
              <p className="border-t pt-4 text-sm text-muted-foreground">
                اتصرفت بتاريخ {snapshot.paid_at ? new Date(snapshot.paid_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
              </p>
            )}

            {snapshot.approval_notes && (
              <p className="mt-4 text-sm text-muted-foreground">ملاحظات الاعتماد: {snapshot.approval_notes}</p>
            )}
            {snapshot.rejected_reason && (
              <p className="mt-4 text-sm text-destructive">سبب الرفض: {snapshot.rejected_reason}</p>
            )}
            {isLocked && (
              <p className="mt-4 text-xs text-muted-foreground">
                السنابشوت ده اتقفل — مفيش إعادة حساب أو تعديل ممكن بعد {snapshot.status === 'paid' ? 'الصرف' : 'الاعتماد'}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
