'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { EmployeeDetail, UpdateEmployeeBody } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function EmployeeDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockForm, setShowBlockForm] = useState(false);

  function load() {
    authedFetch<EmployeeDetail>(`/admin/employees/${userId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الموظف'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId]);

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const form = new FormData(e.target as HTMLFormElement);
    const body: UpdateEmployeeBody = {
      full_name: form.get('full_name') as string,
      department: form.get('department') as string,
      title: (form.get('title') as string) || undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/employees/${userId}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBlock(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/employees/${userId}/block`, {
        method: 'POST',
        body: JSON.stringify({ reason: blockReason }),
      });
      setShowBlockForm(false);
      setBlockReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnblock() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/employees/${userId}/unblock`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !detail) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!detail) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  const { employee } = detail;

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{employee.full_name}</h1>
          {employee.is_blocked ? (
            <Badge variant="destructive">محظور</Badge>
          ) : employee.is_active ? (
            <Badge variant="secondary">نشط</Badge>
          ) : (
            <Badge variant="outline">غير نشط</Badge>
          )}
        </div>
        <Button variant="outline" onClick={() => router.push('/employees')}>
          رجوع للقايمة
        </Button>
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <form onSubmit={handleUpdate}>
            <CardHeader>
              <CardTitle className="text-base">البيانات — كود {employee.employee_code}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="full_name">الاسم بالكامل</Label>
                <Input id="full_name" name="full_name" defaultValue={employee.full_name} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="department">القسم</Label>
                <Input id="department" name="department" defaultValue={employee.department} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">المسمّى الوظيفي</Label>
                <Input id="title" name="title" defaultValue={employee.title ?? ''} />
              </div>
              <p className="text-sm text-muted-foreground" dir="ltr">
                {employee.phone_number}
              </p>
            </CardContent>
            <CardFooter className="gap-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'جاري الحفظ…' : 'حفظ التعديلات'}
              </Button>
              {employee.is_blocked ? (
                <Button type="button" variant="outline" disabled={isSaving} onClick={handleUnblock}>
                  إلغاء الحظر
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSaving}
                  onClick={() => setShowBlockForm((s) => !s)}
                >
                  حظر
                </Button>
              )}
            </CardFooter>
          </form>

          {showBlockForm && (
            <form onSubmit={handleBlock} className="border-t px-6 py-4">
              <Label htmlFor="block_reason">سبب الحظر</Label>
              <Input
                id="block_reason"
                className="mt-2"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                minLength={3}
                required
              />
              <Button type="submit" variant="destructive" size="sm" className="mt-3" disabled={isSaving}>
                تأكيد الحظر
              </Button>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">الأدوار</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش أدوار متعيّنة</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدور</TableHead>
                    <TableHead>اتعيّن في</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.roles.map((role) => (
                    <TableRow key={role.role_id}>
                      <TableCell>{role.display_name}</TableCell>
                      <TableCell>{new Date(role.assigned_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">آخر تسجيلات الدخول</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.recent_logins.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش سجل</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الجهاز</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.recent_logins.map((login, i) => (
                    <TableRow key={i}>
                      <TableCell>{login.device_name ?? login.device_platform ?? '—'}</TableCell>
                      <TableCell dir="ltr">{login.ip_address ?? '—'}</TableCell>
                      <TableCell>{new Date(login.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">آخر الأنشطة</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.recent_activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش نشاط مسجّل</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفعل</TableHead>
                    <TableHead>الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.recent_activity.map((activity, i) => (
                    <TableRow key={i}>
                      <TableCell>{activity.action}</TableCell>
                      <TableCell>{new Date(activity.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
