'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CompanyListRowDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function TechnicianCompaniesPage() {
  const { isLoading, authedFetch } = useAuth();
  const [companies, setCompanies] = useState<CompanyListRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<CompanyListRowDto[]>('/admin/technician-companies')
      .then(setCompanies)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الشركات'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">شركات/فرق الفنيين</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          إشراف للقراءة بس — الإدارة (إضافة/إزالة أعضاء، الفروع) ذاتية من داخل تطبيق الفني نفسه.
        </p>
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!companies && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
      {companies && companies.length === 0 && <p className="text-muted-foreground">مفيش شركات/فرق لسه</p>}

      {companies && companies.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>السجل التجاري</TableHead>
              <TableHead>عدد الفروع</TableHead>
              <TableHead>عدد الأعضاء</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>تاريخ الإنشاء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((company) => (
              <TableRow key={company.id}>
                <TableCell>
                  <Link href={`/technician-companies/${company.id}`} className="font-medium hover:underline">
                    {company.name}
                  </Link>
                </TableCell>
                <TableCell dir="ltr" className="text-start">
                  {company.commercial_registration_number ?? '—'}
                </TableCell>
                <TableCell>{company.branch_count}</TableCell>
                <TableCell>{company.staff_count}</TableCell>
                <TableCell>
                  <Badge variant={company.is_active ? 'secondary' : 'outline'}>
                    {company.is_active ? 'نشطة' : 'غير نشطة'}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
