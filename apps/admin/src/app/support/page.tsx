'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ComplaintResponseDto, ComplaintStatus } from '@baytak/shared-types';
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
import {
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_SEVERITY_LABELS,
  COMPLAINT_STATUS_LABELS,
  complaintSeverityTone,
  complaintStatusTone,
  OPEN_COMPLAINT_STATUSES,
} from '@/lib/support-labels';

const STATUS_FILTERS: { value: ComplaintStatus | 'all' | 'open'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'open', label: 'مفتوحة (كل الأنواع)' },
  { value: 'resolved', label: 'اتحلّت' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'closed', label: 'مقفولة' },
];

export default function SupportPage() {
  const { isLoading, authedFetch } = useAuth();
  const [complaints, setComplaints] = useState<ComplaintResponseDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | 'all' | 'open'>('open');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<ComplaintResponseDto[]>('/admin/complaints')
      .then(setComplaints)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الشكاوى'));
  }, [authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['support'], load);

  // مفيش فلترة server-side لهذا المسار (listAllForAdmin بيرجّع الكل) — عدد الشكاوى المتوقع
  // صغير بما يكفي لفلترة client-side، نفس السبب اللي خلّى قايمة الفلاجز من غير صفحات.
  const filtered = useMemo(() => {
    if (!complaints) return null;
    if (statusFilter === 'all') return complaints;
    if (statusFilter === 'open') return complaints.filter((c) => OPEN_COMPLAINT_STATUSES.has(c.complaint_status));
    return complaints.filter((c) => c.complaint_status === statusFilter);
  }, [complaints, statusFilter]);

  return (
    <AppShell>
      <PageHeader title="الشكاوى" />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !filtered && <TableSkeleton columns={6} />}
      {filtered && filtered.length === 0 && <EmptyState title="مفيش شكاوى مطابقة" />}

      {filtered && filtered.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>العنوان</TableHead>
              <TableHead>الفئة</TableHead>
              <TableHead>الخطورة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>تاريخ الفتح</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((complaint) => (
              <TableRow key={complaint.id}>
                <TableCell>
                  <Link href={`/support/${complaint.id}`} className="block" dir="ltr">
                    {complaint.complaint_number}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/support/${complaint.id}`} className="block">
                    {complaint.title}
                  </Link>
                </TableCell>
                <TableCell>{COMPLAINT_CATEGORY_LABELS[complaint.category]}</TableCell>
                <TableCell>
                  <StatusChip tone={complaintSeverityTone(complaint.severity)}>
                    {COMPLAINT_SEVERITY_LABELS[complaint.severity]}
                  </StatusChip>
                </TableCell>
                <TableCell>
                  <StatusChip tone={complaintStatusTone(complaint.complaint_status)}>
                    {COMPLAINT_STATUS_LABELS[complaint.complaint_status]}
                  </StatusChip>
                </TableCell>
                <TableCell>{new Date(complaint.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
