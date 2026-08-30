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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS } from '@/lib/technician-labels';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';

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
  // بحث الفنيين (docs/08 §77-C1، طلب مالك) — الصفحة كانت فيها فلتر حالة **بس**، يعني الوصول
  // لفني بعينه كان تقليب صفحة صفحة. الـdebounce عشان ما نضربش نداء مع كل حرف.
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 400);
  const [error, setError] = useState<string | null>(null);

  function loadTechnicians() {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (statusFilter !== 'all') params.set('verification_status', statusFilter);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    authedFetchPaginated<AdminTechnicianResponseDto>(`/admin/technicians?${params.toString()}`)
      .then(({ items, meta }) => {
        setTechnicians(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفنيين'));
  }

  useAdminLiveRefresh(['technicians'], loadTechnicians);

  useEffect(() => {
    loadTechnicians();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, page, statusFilter, debouncedSearch, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader
        title="الفنيين"
        description="بحث ومراجعة حالة الاعتماد والتخصصات والأداء التشغيلي لكل فني"
        actions={<Badge variant="outline">{total} فني</Badge>}
      />

      <div className="mb-5 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
        <div className="max-w-xl">
          <Label htmlFor="technician_search" className="text-sm font-medium">ابحث عن فني</Label>
          <Input
            id="technician_search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="اسم، رقم موبايل، كود فني، أو رقم قومي"
            className="mt-2"
          />
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {/* الرقم القومي بيتبحث عنه **بمطابقة كاملة بس** — مش جزئية. السبب مش اختيار واجهة:
              القيمة متخزّنة مشفّرة، والبحث بيمر على blind index (HMAC) اللي بطبيعته بيطابق
              القيمة كاملة أو لأ. توضيح ده هنا بيمنع الموظف يفتكر إن البحث بايظ. */}
            الرقم القومي لازم يتكتب كامل (14 رقم)؛ باقي الحقول تقبل جزءًا من النص.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
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
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !technicians && <TableSkeleton columns={7} />}
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
                <TableHead>الاتصال</TableHead>
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
                  <TableCell>
                    <Badge variant={tech.online ? 'secondary' : 'outline'}>
                      {tech.online ? 'أونلاين' : 'أوفلاين'}
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
