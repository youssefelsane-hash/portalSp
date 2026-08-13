'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { CreateRoleBody, RoleResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

// باني الأدوار الديناميكي (ADR-0010) — كانت مؤجّلة عمدًا كـbacklog بند 43. Super Admin يقدر
// ينشئ أدوار إدارية جديدة بلا كود جديد (زي "مشرف إقليمي"، "مراجع مالية")، ويتحكم في صلاحيات كل
// دور من مصفوفة (شاشة التفاصيل). الأدوار النظامية الخمسة (super_admin, ops_manager, ...) محمية
// من الحذف/التعطيل — راجع apps/api/src/modules/admin/README.md § باني الأدوار.
export default function RolesPage() {
  const { isLoading, authedFetch } = useAuth();
  const [roles, setRoles] = useState<RoleResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    authedFetch<RoleResponseDto[]>('/admin/roles')
      .then(setRoles)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأدوار'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateRoleBody = {
      name: form.get('name') as string,
      display_name: form.get('display_name') as string,
      description: (form.get('description') as string) || undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch('/admin/roles', { method: 'POST', body: JSON.stringify(body) });
      setShowNew(false);
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
        title="الأدوار الإدارية"
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + دور جديد
          </Button>
        }
      />
      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="flex flex-col gap-2">
              <Label htmlFor="role_name">الاسم الداخلي (snake_case، ثابت بعد الإنشاء)</Label>
              <Input id="role_name" name="name" placeholder="مثال: regional_supervisor" required dir="ltr" />
              <Label htmlFor="role_display_name">الاسم المعروض</Label>
              <Input id="role_display_name" name="display_name" placeholder="مثال: مشرف إقليمي" required />
              <Label htmlFor="role_description">الوصف (اختياري)</Label>
              <Input id="role_description" name="description" placeholder="وصف مختصر لمسؤوليات الدور" />
              <Button type="submit" size="sm" disabled={isSaving} className="mt-2 w-fit">
                إنشاء الدور
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">كل الأدوار</CardTitle>
        </CardHeader>
        <CardContent>
          {!roles ? (
            <TableSkeleton columns={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم الداخلي</TableHead>
                  <TableHead>الاسم المعروض</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell dir="ltr">
                      {role.name}
                      {role.isSuperAdmin && <Badge variant="secondary" className="mr-2">كل الصلاحيات</Badge>}
                    </TableCell>
                    <TableCell>{role.displayName}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                      {role.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {role.isSystem && <Badge variant="outline">نظامي</Badge>}
                      {!role.isActive && <Badge variant="destructive" className="mr-2">معطّل</Badge>}
                    </TableCell>
                    <TableCell>
                      <Link href={`/roles/${role.id}`} className="text-sm underline-offset-2 hover:underline">
                        التفاصيل والصلاحيات
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
