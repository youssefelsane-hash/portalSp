'use client';

import { useEffect, useState } from 'react';
import type { WorkerResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const STATUS_LABELS: Record<string, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  suspended: 'موقوفة',
};

const SPECIALTY_LABELS: Record<string, string> = {
  cleaning_hourly: 'تنظيف بالساعة',
  babysitting_hourly: 'جليسة أطفال بالساعة',
  live_in_maid_monthly: 'مقيمة شهرية',
};

// قطاع الخدمات المنزلية (docs/08 §12, ADR-0004) — كانت فجوة موثّقة صراحة: GET/POST
// /admin/domestic-workers كانا موجودين ومختبرين في الباك-إند من زمان، بصفر شاشة أدمن تراجع
// طلبات مقدّمي الخدمة الجداد — نفس فئة الفجوة الموجودة في مستندات/شهادات الفنيين بالظبط.
export default function DomesticWorkersPage() {
  const { isLoading, authedFetch } = useAuth();
  const [workers, setWorkers] = useState<WorkerResponseDto[] | null>(null);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    const query = status ? `?status=${status}` : '';
    authedFetch<WorkerResponseDto[]>(`/admin/domestic-workers${query}`)
      .then(setWorkers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل مقدّمي الخدمة'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, status]);

  async function handleReview(workerId: string, reviewStatus: 'approved' | 'rejected') {
    const notes = reviewStatus === 'rejected' ? window.prompt('سبب الرفض؟') : undefined;
    if (reviewStatus === 'rejected' && !notes) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/domestic-workers/${workerId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status: reviewStatus, notes }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="مقدّمو الخدمات المنزلية"
        actions={
          <SelectNative value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
            <option value="pending">قيد المراجعة</option>
            <option value="approved">معتمدة</option>
            <option value="rejected">مرفوضة</option>
            <option value="suspended">موقوفة</option>
            <option value="">الكل</option>
          </SelectNative>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {!workers && <p className="text-muted-foreground">جاري التحميل…</p>}
      {workers && workers.length === 0 && <EmptyState title="مفيش مقدّمي خدمة بهذه الحالة" />}

      {workers && workers.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الكود</TableHead>
              <TableHead>التخصصات</TableHead>
              <TableHead>الخبرة</TableHead>
              <TableHead>السعر بالساعة</TableHead>
              <TableHead>السعر الشهري</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((worker) => (
              <TableRow key={worker.id}>
                <TableCell dir="ltr">{worker.worker_code}</TableCell>
                <TableCell>{worker.specialties.map((s) => SPECIALTY_LABELS[s] ?? s).join('، ')}</TableCell>
                <TableCell>{worker.years_of_experience} سنين</TableCell>
                <TableCell>{worker.hourly_rate_cents !== null ? formatEgp(worker.hourly_rate_cents) : '—'}</TableCell>
                <TableCell>{worker.monthly_rate_cents !== null ? formatEgp(worker.monthly_rate_cents) : '—'}</TableCell>
                <TableCell>
                  <Badge variant={worker.verification_status === 'approved' ? 'secondary' : 'outline'}>
                    {STATUS_LABELS[worker.verification_status] ?? worker.verification_status}
                  </Badge>
                  {worker.verification_notes && (
                    <p className="mt-1 text-xs text-muted-foreground">{worker.verification_notes}</p>
                  )}
                </TableCell>
                <TableCell className="flex gap-2">
                  {worker.verification_status === 'pending' && (
                    <>
                      <Button size="sm" disabled={isSaving} onClick={() => handleReview(worker.id, 'approved')}>
                        اعتماد
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isSaving}
                        onClick={() => handleReview(worker.id, 'rejected')}
                      >
                        رفض
                      </Button>
                    </>
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
