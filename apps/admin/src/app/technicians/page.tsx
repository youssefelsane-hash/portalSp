'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminTechnicianResponseDto, TechnicianVerificationStatus } from '@baytak/shared-types';
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
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS } from '@/lib/technician-labels';

const PER_PAGE = 20;

const STATUS_FILTERS: { value: TechnicianVerificationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'pending', label: VERIFICATION_STATUS_LABELS.pending },
  { value: 'documents_submitted', label: VERIFICATION_STATUS_LABELS.documents_submitted },
  { value: 'under_review', label: VERIFICATION_STATUS_LABELS.under_review },
  { value: 'approved', label: VERIFICATION_STATUS_LABELS.approved },
  { value: 'rejected', label: VERIFICATION_STATUS_LABELS.rejected },
];

function statusBadgeVariant(status: TechnicianVerificationStatus) {
  if (status === 'approved') return 'secondary' as const;
  if (status === 'rejected' || status === 'suspended') return 'destructive' as const;
  return 'outline' as const;
}

export default function TechniciansPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [technicians, setTechnicians] = useState<AdminTechnicianResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<TechnicianVerificationStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (statusFilter !== 'all') params.set('verification_status', statusFilter);
    authedFetchPaginated<AdminTechnicianResponseDto>(`/admin/technicians?${params.toString()}`)
      .then(({ items, meta }) => {
        setTechnicians(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفنيين'));
  }, [isLoading, page, statusFilter, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="الفنيين" />

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => {
              setStatusFilter(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !technicians && <TableSkeleton columns={6} />}
      {technicians && technicians.length === 0 && <EmptyState title="مفيش فنيين مطابقين" />}

      {technicians && technicians.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>المستوى</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التقييم</TableHead>
                <TableHead>طلبات مكتملة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {technicians.map((tech) => (
                <TableRow key={tech.id}>
                  <TableCell>
                    <Link href={`/technicians/${tech.id}`} className="block">
                      {tech.technician_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/technicians/${tech.id}`} className="block">
                      {tech.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{LEVEL_LABELS[tech.current_level]}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(tech.verification_status)}>
                      {VERIFICATION_STATUS_LABELS[tech.verification_status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{tech.average_rating.toFixed(2)} ({tech.total_ratings_count})</TableCell>
                  <TableCell>{tech.completed_orders_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="فني" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
