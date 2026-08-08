'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CompanyDetailResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { VERIFICATION_STATUS_LABELS, LEVEL_LABELS } from '@/lib/technician-labels';

const TEAM_ROLE_LABELS: Record<string, string> = {
  independent: 'مستقل',
  owner: 'مالك',
  manager: 'مدير',
  supervisor: 'مشرف',
  worker: 'عامل',
};

export default function TechnicianCompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const [detail, setDetail] = useState<CompanyDetailResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<CompanyDetailResponseDto>(`/admin/technician-companies/${id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تفاصيل الشركة'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  return (
    <AppShell>
      {error && <p className="text-destructive">{error}</p>}
      {!detail && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

      {detail && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">{detail.company.name}</h1>
            <Badge variant={detail.company.is_active ? 'secondary' : 'outline'}>
              {detail.company.is_active ? 'نشطة' : 'غير نشطة'}
            </Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">بيانات الشركة</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">السجل التجاري: </span>
                <span dir="ltr">{detail.company.commercial_registration_number ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">تاريخ الإنشاء: </span>
                {new Date(detail.company.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الفروع ({detail.branches.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.branches.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش فروع لسه</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>العنوان</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.branches.map((branch) => (
                      <TableRow key={branch.id}>
                        <TableCell>{branch.name}</TableCell>
                        <TableCell>{branch.address_line ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={branch.is_active ? 'secondary' : 'outline'}>
                            {branch.is_active ? 'نشط' : 'غير نشط'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">الأعضاء ({detail.staff.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الكود</TableHead>
                    <TableHead>الدور بالشركة</TableHead>
                    <TableHead>المستوى</TableHead>
                    <TableHead>حالة التوثيق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.staff.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell>{member.full_name}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {member.technician_code}
                      </TableCell>
                      <TableCell>{TEAM_ROLE_LABELS[member.team_role] ?? member.team_role}</TableCell>
                      <TableCell>{LEVEL_LABELS[member.current_level as keyof typeof LEVEL_LABELS] ?? member.current_level}</TableCell>
                      <TableCell>
                        {VERIFICATION_STATUS_LABELS[member.verification_status as keyof typeof VERIFICATION_STATUS_LABELS] ??
                          member.verification_status}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
