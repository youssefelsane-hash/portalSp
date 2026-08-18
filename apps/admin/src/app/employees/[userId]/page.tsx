'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type {
  AssignRoleBody,
  EmployeeDetail,
  EmployeePresenceDto,
  EmployeeSessionDto,
  RoleResponseDto,
  UpdateEmployeeBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const PRESENCE_LABELS: Record<string, string> = { active: 'نشط الآن', idle: 'خامل', offline: 'غير متصل' };
const PRESENCE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  idle: 'secondary',
  offline: 'outline',
};

export default function EmployeeDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [allRoles, setAllRoles] = useState<RoleResponseDto[] | null>(null);
  const [selectedRoleName, setSelectedRoleName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockForm, setShowBlockForm] = useState(false);
  // Script 5 — حالة حية + جلسات. مفيش حاجة منهم لو الأدمن الحالي معندوش employees.activity.view/
  // employees.sessions.view (403 بيتلقّط بصمت، الكارت بيختفي — "متعرضش أكتر مما يسمح الصلاحية").
  const [presence, setPresence] = useState<EmployeePresenceDto | null>(null);
  const [sessions, setSessions] = useState<EmployeeSessionDto[] | null>(null);
  const [openAlertsCount, setOpenAlertsCount] = useState<number | null>(null);

  function load() {
    authedFetch<EmployeeDetail>(`/admin/employees/${userId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الموظف'));
    authedFetch<EmployeePresenceDto>(`/admin/workforce/employees/${userId}/presence`)
      .then(setPresence)
      .catch(() => setPresence(null));
    authedFetch<EmployeeSessionDto[]>(`/admin/workforce/employees/${userId}/sessions`)
      .then(setSessions)
      .catch(() => setSessions(null));
    authedFetch<{ meta: { total: number } }>(`/admin/security/events?actor_user_id=${userId}&status=open`)
      .then((res) => setOpenAlertsCount(res.meta.total))
      .catch(() => setOpenAlertsCount(null));
  }

  async function handleRevokeSession(sessionId: string) {
    try {
      await authedFetch(`/admin/workforce/employees/${userId}/sessions/${sessionId}`, { method: 'DELETE' });
      toast.success('اتلغت الجلسة');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل إلغاء الجلسة');
    }
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetch<RoleResponseDto[]>('/admin/roles')
      .then(setAllRoles)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأدوار المتاحة'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, userId]);

  async function handleAssignRole(e: FormEvent) {
    e.preventDefault();
    if (!selectedRoleName) return;
    setIsSavingRole(true);
    setError(null);
    try {
      const body: AssignRoleBody = { role_name: selectedRoleName };
      await authedFetch(`/admin/users/${userId}/roles`, { method: 'POST', body: JSON.stringify(body) });
      setSelectedRoleName('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSavingRole(false);
    }
  }

  async function handleRevokeRole(roleName: string) {
    setIsSavingRole(true);
    setError(null);
    try {
      await authedFetch(`/admin/users/${userId}/roles/${roleName}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSavingRole(false);
    }
  }

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

  // §24 — DELETE /admin/employees/:userId موجود ومختبر من زمان (soft-delete دائم، عكس block
  // القابل للرجوع) بس صفر زرار له في أي شاشة أدمن — الأداة الوحيدة كانت block. حذف دائم، مفيش
  // restore، فالتوجيه للقايمة بعد النجاح مباشرة (نفس نمط /roles/[id]).
  async function handleDelete() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/employees/${userId}`, { method: 'DELETE' });
      router.push('/employees');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
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
      <PageHeader
        title={
          <>
            {employee.full_name}
            {employee.is_blocked ? (
              <Badge variant="destructive">محظور</Badge>
            ) : employee.is_active ? (
              <Badge variant="secondary">نشط</Badge>
            ) : (
              <Badge variant="outline">غير نشط</Badge>
            )}
            {presence && <Badge variant={PRESENCE_BADGE_VARIANT[presence.state]}>{PRESENCE_LABELS[presence.state]}</Badge>}
            {openAlertsCount !== null && openAlertsCount > 0 && (
              <Link href={`/security-center?actor_user_id=${userId}`}>
                <Badge variant="destructive">{openAlertsCount} تنبيه أمني مفتوح</Badge>
              </Link>
            )}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => router.push('/employees')}>
            رجوع للقايمة
          </Button>
        }
      />

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
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="destructive" disabled={isSaving}>
                    حذف الحساب
                  </Button>
                }
                title="حذف حساب الموظف نهائيًا"
                description="ده حذف دائم — الحساب مش هيقدر يسجّل دخول تاني، ومفيش استرجاع بعد كده."
                confirmLabel="حذف نهائي"
                onConfirm={handleDelete}
              />
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
          <CardContent className="flex flex-col gap-4">
            {detail.roles.length === 0 ? (
              <EmptyState title="مفيش أدوار متعيّنة" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدور</TableHead>
                    <TableHead>اتعيّن في</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.roles.map((role) => (
                    <TableRow key={role.role_id}>
                      <TableCell>{role.display_name}</TableCell>
                      <TableCell>{new Date(role.assigned_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isSavingRole}
                          onClick={() => handleRevokeRole(role.role_name)}
                        >
                          سحب
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {allRoles && allRoles.filter((r) => !detail.roles.some((dr) => dr.role_name === r.name)).length > 0 && (
              <form onSubmit={handleAssignRole} className="flex items-end gap-2 border-t pt-4">
                <div className="flex-1">
                  <Label htmlFor="new_role">منح دور جديد</Label>
                  <SelectNative
                    id="new_role"
                    value={selectedRoleName}
                    onChange={(e) => setSelectedRoleName(e.target.value)}
                  >
                    <option value="">— اختر دور —</option>
                    {allRoles
                      .filter((r) => !detail.roles.some((dr) => dr.role_name === r.name))
                      .map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.displayName}
                        </option>
                      ))}
                  </SelectNative>
                </div>
                <Button type="submit" size="sm" disabled={!selectedRoleName || isSavingRole}>
                  منح
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">آخر تسجيلات الدخول</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.recent_logins.length === 0 ? (
              <EmptyState title="مفيش سجل" />
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
              <EmptyState title="مفيش نشاط مسجّل" />
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

        {sessions && sessions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">الجلسات المفتوحة (Script 5)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الجهاز</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>آخر نشاط</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>{session.deviceName ?? session.devicePlatform ?? '—'}</TableCell>
                      <TableCell dir="ltr">{session.ipAddress ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleString('ar-EG-u-nu-latn') : '—'}
                      </TableCell>
                      <TableCell>
                        {session.isRevoked ? <Badge variant="outline">ملغاة</Badge> : <Badge variant="secondary">نشطة</Badge>}
                      </TableCell>
                      <TableCell>
                        {!session.isRevoked && (
                          <Button variant="ghost" size="sm" onClick={() => handleRevokeSession(session.id)}>
                            إلغاء
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
