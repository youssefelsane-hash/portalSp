'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  AuditLogResponseDto,
  CreateRoleBody,
  PermissionResponseDto,
  RoleDetailResponseDto,
  SetRolePermissionsBody,
  UpdateRoleBody,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const AUDIT_ACTION_LABELS_AR: Record<string, string> = {
  'role.created': 'إنشاء الدور',
  'role.updated': 'تعديل الدور',
  'role.cloned': 'نسخ الدور',
  'role.deleted': 'حذف الدور',
  'role.permissions_changed': 'تعديل صلاحيات الدور',
  'role.assigned': 'تعيين الدور لمستخدم',
  'role.revoked': 'سحب الدور من مستخدم',
};

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();

  const [detail, setDetail] = useState<RoleDetailResponseDto | null>(null);
  const [catalog, setCatalog] = useState<PermissionResponseDto[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [showClone, setShowClone] = useState(false);

  function load() {
    authedFetch<RoleDetailResponseDto>(`/admin/roles/${id}`)
      .then((d) => {
        setDetail(d);
        setSelectedPermissions(new Set(d.permission_names));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الدور'));
    authedFetch<AuditLogResponseDto[]>(`/admin/audit-logs?entity_type=role&entity_id=${id}&per_page=15`)
      .then(setAuditLogs)
      .catch(() => setAuditLogs([]));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetch<PermissionResponseDto[]>('/admin/permissions').then(setCatalog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  const permissionsByResource = useMemo(() => {
    if (!catalog) return new Map<string, PermissionResponseDto[]>();
    const map = new Map<string, PermissionResponseDto[]>();
    for (const p of catalog) {
      const list = map.get(p.resource) ?? [];
      list.push(p);
      map.set(p.resource, list);
    }
    return map;
  }, [catalog]);

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    const form = new FormData(e.target as HTMLFormElement);
    const body: UpdateRoleBody = {
      display_name: form.get('display_name') as string,
      description: (form.get('description') as string) || undefined,
    };
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive() {
    if (!detail) return;
    setIsSaving(true);
    setError(null);
    try {
      const body: UpdateRoleBody = { is_active: !detail.role.isActive };
      await authedFetch(`/admin/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  function togglePermission(name: string) {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSavePermissions() {
    setIsSaving(true);
    setError(null);
    try {
      const body: SetRolePermissionsBody = { permission_names: Array.from(selectedPermissions) };
      await authedFetch(`/admin/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClone(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const body: CreateRoleBody = {
      name: form.get('name') as string,
      display_name: form.get('display_name') as string,
    };
    setIsSaving(true);
    setError(null);
    try {
      const cloned = await authedFetch<{ id: string }>(`/admin/roles/${id}/clone`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(`/roles/${cloned.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/roles/${id}`, { method: 'DELETE' });
      router.push('/roles');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
      setIsSaving(false);
    }
  }

  if (!detail) {
    return (
      <AppShell>
        {error ? <p className="text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
      </AppShell>
    );
  }

  const { role, users } = detail;
  const permissionsChanged =
    selectedPermissions.size !== detail.permission_names.length ||
    detail.permission_names.some((p) => !selectedPermissions.has(p));

  return (
    <AppShell>
      <PageHeader
        title={role.displayName}
        description={<span dir="ltr">{role.name}</span>}
        actions={
          <>
            {role.isSystem && <Badge variant="outline">دور نظامي — محمي من الحذف/التعطيل</Badge>}
            {role.isSuperAdmin && <Badge variant="secondary">كل الصلاحيات تلقائيًا</Badge>}
            {!role.isActive && <Badge variant="destructive">معطّل</Badge>}
          </>
        }
      />
      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">بيانات الدور</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdate} className="flex flex-col gap-2">
                <Label htmlFor="display_name">الاسم المعروض</Label>
                <Input id="display_name" name="display_name" defaultValue={role.displayName} required />
                <Label htmlFor="description">الوصف</Label>
                <Textarea id="description" name="description" defaultValue={role.description ?? ''} rows={2} />
                <div className="mt-2 flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={isSaving}>
                    حفظ
                  </Button>
                  {!role.isSystem && (
                    <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={toggleActive}>
                      {role.isActive ? 'تعطيل الدور' : 'تفعيل الدور'}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" disabled={isSaving} onClick={() => setShowClone((s) => !s)}>
                    نسخ الدور
                  </Button>
                  {!role.isSystem && (
                    <ConfirmDialog
                      trigger={
                        <Button type="button" size="sm" variant="ghost" disabled={isSaving}>
                          حذف الدور
                        </Button>
                      }
                      title={`متأكد إنك عايز تحذف الدور "${role.displayName}"؟`}
                      confirmLabel="حذف"
                      onConfirm={handleDelete}
                    />
                  )}
                </div>
              </form>

              {showClone && (
                <form onSubmit={handleClone} className="mt-4 flex flex-col gap-2 border-t pt-4">
                  <Label htmlFor="clone_name">اسم الدور الجديد (snake_case)</Label>
                  <Input id="clone_name" name="name" required dir="ltr" />
                  <Label htmlFor="clone_display_name">الاسم المعروض للدور الجديد</Label>
                  <Input id="clone_display_name" name="display_name" required />
                  <Button type="submit" size="sm" disabled={isSaving} className="mt-1 w-fit">
                    نسخ بكل الصلاحيات الحالية
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">مصفوفة الصلاحيات</CardTitle>
            </CardHeader>
            <CardContent>
              {role.isSuperAdmin ? (
                <p className="text-sm text-muted-foreground">
                  الدور ده عنده كل الصلاحيات تلقائيًا (is_super_admin) — مش محتاج تحديد صلاحيات فردية.
                </p>
              ) : !catalog ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {Array.from(permissionsByResource.entries()).map(([resource, perms]) => (
                    <div key={resource}>
                      <h3 dir="ltr" className="mb-1 text-sm font-semibold text-muted-foreground">
                        {resource}
                      </h3>
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        {perms.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedPermissions.has(p.name)}
                              onChange={() => togglePermission(p.name)}
                            />
                            <span dir="ltr">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            {!role.isSuperAdmin && (
              <CardFooter>
                <Button size="sm" disabled={isSaving || !permissionsChanged} onClick={handleSavePermissions}>
                  حفظ الصلاحيات
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المستخدمين الحاملين للدور ({users.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش حد عنده الدور ده دلوقتي</p>
              ) : (
                <Table>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.user_id}>
                        <TableCell>{u.full_name}</TableCell>
                        <TableCell dir="ltr" className="text-muted-foreground">
                          {u.phone_number}
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
              <CardTitle className="text-base">سجل التدقيق</CardTitle>
            </CardHeader>
            <CardContent>
              {!auditLogs ? (
                <p className="text-sm text-muted-foreground">جاري التحميل…</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش أي تعديلات مسجّلة لسه</p>
              ) : (
                <ul className="flex flex-col gap-3 text-sm">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="border-b pb-2 last:border-0">
                      <div className="font-medium">{AUDIT_ACTION_LABELS_AR[log.action] ?? log.action}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString('ar-EG')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
