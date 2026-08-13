'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EmployeeResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const PER_PAGE = 20;

export default function EmployeesPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [employees, setEmployees] = useState<EmployeeResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetchPaginated<EmployeeResponseDto>(`/admin/employees?page=${page}&per_page=${PER_PAGE}`)
      .then(({ items, meta }) => {
        setEmployees(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الموظفين'));
  }, [isLoading, page, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader
        title="الموظفين"
        actions={
          <Button asChild>
            <Link href="/employees/new">+ إضافة موظف</Link>
          </Button>
        }
      />

      {error && <p className="text-destructive">{error}</p>}
      {!error && !employees && <TableSkeleton columns={5} />}
      {employees && employees.length === 0 && <EmptyState title="مفيش موظفين لسه" />}

      {employees && employees.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>المسمّى الوظيفي</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.user_id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/employees/${employee.user_id}`} className="block">
                      {employee.employee_code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/employees/${employee.user_id}`} className="block">
                      {employee.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{employee.department}</TableCell>
                  <TableCell>{employee.title ?? '—'}</TableCell>
                  <TableCell>
                    {employee.is_blocked ? (
                      <Badge variant="destructive">محظور</Badge>
                    ) : employee.is_active ? (
                      <Badge variant="secondary">نشط</Badge>
                    ) : (
                      <Badge variant="outline">غير نشط</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages} ({total} موظف إجمالاً)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
