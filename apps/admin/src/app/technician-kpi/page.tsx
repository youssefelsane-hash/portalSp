'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TechnicianKpiSnapshotResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { KPI_STATUS_LABELS, KPI_STATUS_TONE } from '@/lib/technician-kpi-labels';

const now = new Date();

// نظرة عامة إدارية على KPI الشهري للفنيين (docs/11 §3) — المنصة بتحسب وتعرض بس، الأدمن يقرر.
export default function TechnicianKpiPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [snapshots, setSnapshots] = useState<TechnicianKpiSnapshotResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcResult, setCalcResult] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams({ period_year: String(year), period_month: String(month), per_page: '100' });
    if (statusFilter) params.set('status', statusFilter);
    authedFetchPaginated<TechnicianKpiSnapshotResponseDto>(`/admin/technician-kpi?${params.toString()}`)
      .then((res) => {
        setSnapshots(res.items);
        setTotal(res.meta.total ?? res.items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الـKPI'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, year, month, statusFilter]);

  async function handleCalculate() {
    setIsCalculating(true);
    setError(null);
    setCalcResult(null);
    try {
      const res = await authedFetch<{ calculated: number; skippedLocked: number }>('/admin/technician-kpi/calculate', {
        method: 'POST',
        body: JSON.stringify({ period_year: year, period_month: month }),
      });
      setCalcResult(`اتحسب لـ${res.calculated} فني — ${res.skippedLocked} كانوا مقفولين (اتوافق عليهم/اتصرفوا بالفعل)`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في الحساب');
    } finally {
      setIsCalculating(false);
    }
  }

  const eligibleCount = (snapshots ?? []).filter((s) => s.is_eligible).length;
  const totalSuggested = (snapshots ?? []).reduce((sum, s) => sum + (s.suggested_bonus_cents ?? 0), 0);
  const totalApproved = (snapshots ?? []).reduce((sum, s) => sum + (s.approved_bonus_cents ?? 0), 0);

  return (
    <AppShell>
      <PageHeader
        title="KPI الشهري للفنيين"
        actions={
          <>
            <SelectNative value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-28">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  شهر {m}
                </option>
              ))}
            </SelectNative>
            <SelectNative value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24">
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectNative>
            <Button size="sm" disabled={isCalculating} onClick={handleCalculate}>
              {isCalculating ? 'جاري الحساب…' : 'احسب الشهر ده'}
            </Button>
          </>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {calcResult && <p className="mb-4 text-sm text-muted-foreground">{calcResult}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">عدد الفنيين ({total})</p>
            <p className="text-lg font-semibold">{eligibleCount} مؤهّل</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي المقترح</p>
            <p className="text-lg font-semibold">{formatEgp(totalSuggested)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي المعتمد</p>
            <p className="text-lg font-semibold">{formatEgp(totalApproved)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              <option value="calculated">محسوبة</option>
              <option value="approved">اتوافق عليها</option>
              <option value="paid">اتصرفت</option>
              <option value="rejected">مرفوضة</option>
            </SelectNative>
          </CardContent>
        </Card>
      </div>

      {!snapshots ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">مفيش بيانات KPI للشهر ده لسه — دوس "احسب الشهر ده"</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الفني</TableHead>
              <TableHead>الدرجة الكلية</TableHead>
              <TableHead>مكتملة</TableHead>
              <TableHead>تقييم</TableHead>
              <TableHead>إلغاء</TableHead>
              <TableHead>شكاوى مثبتة</TableHead>
              <TableHead>المقترح</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/technicians/${s.technician_id}`} className="underline-offset-2 hover:underline">
                    {s.technician_id.slice(0, 8)}…
                  </Link>
                </TableCell>
                <TableCell className="font-medium">
                  {s.overall_score ?? '—'}
                  {s.serious_upheld_complaint && (
                    <span className="ms-1 text-xs text-destructive">(شكوى حرجة صفّرت الدرجة)</span>
                  )}
                </TableCell>
                <TableCell>{s.completed_orders_count}</TableCell>
                <TableCell>{s.average_rating ?? '—'}</TableCell>
                <TableCell>{s.cancellation_rate !== null ? `${s.cancellation_rate}%` : '—'}</TableCell>
                <TableCell>{s.complaints_upheld_count}</TableCell>
                <TableCell>{s.suggested_bonus_cents !== null ? formatEgp(s.suggested_bonus_cents) : '—'}</TableCell>
                <TableCell>
                  <StatusChip tone={KPI_STATUS_TONE[s.status]}>{KPI_STATUS_LABELS[s.status]}</StatusChip>
                  {!s.is_eligible && <span className="block text-xs text-muted-foreground">{s.ineligibility_reason}</span>}
                </TableCell>
                <TableCell>
                  <Link href={`/technician-kpi/${s.id}`}>
                    <Button size="sm" variant="outline">
                      التفاصيل
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
