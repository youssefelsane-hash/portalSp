'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AuthSessionResponseDto, WebAuthnCredentialResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { KeyRound, Laptop } from 'lucide-react';

// إدارة Passkeys والأجهزة/الجلسات (ADR-0011 §5/§21) — تسجيل Passkey جديد بيحصل بس جوّه مسار
// MFA login نفسه (قيد الباك-إند الحالي، Phase 1)، فالصفحة دي بتعرض/تلغي بس، مفيش زرار "ضيف
// Passkey" هنا. حذف Passkey/إلغاء كل الجلسات محتاجين Step-Up — بيتعامل معاه تلقائيًا جوّه
// authedFetch (auth-context.tsx)، الصفحة دي مش محتاجة تعرف عن AUTH_006 خالص.
export default function SecurityPage() {
  const { isLoading, authedFetch, user } = useAuth();
  const [credentials, setCredentials] = useState<WebAuthnCredentialResponseDto[] | null>(null);
  const [sessions, setSessions] = useState<AuthSessionResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    authedFetch<WebAuthnCredentialResponseDto[]>('/auth/webauthn/credentials')
      .then(setCredentials)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الـPasskeys'));
    authedFetch<AuthSessionResponseDto[]>('/auth/sessions')
      .then(setSessions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأجهزة'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleRemoveCredential(id: string) {
    try {
      await authedFetch(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' });
      toast.success('اتشال الـPasskey');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل حذف الـPasskey');
    }
  }

  async function handleRevokeSession(id: string) {
    try {
      await authedFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
      toast.success('اتلغت الجلسة');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل إلغاء الجلسة');
    }
  }

  async function handleRevokeAll() {
    try {
      await authedFetch('/auth/sessions/revoke-all', { method: 'POST' });
      toast.success('اتلغت كل الجلسات — هتحتاج تسجّل دخول تاني');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'فشل إلغاء الجلسات');
    }
  }

  return (
    <AppShell>
      <PageHeader title="الأمان والأجهزة" description={`إدارة Passkeys والجلسات المفتوحة لحساب ${user?.full_name ?? ''}`} />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" /> مفاتيح المرور (Passkeys)
            </CardTitle>
            <CardDescription>
              بصمة/Face ID/مفتاح أمان مسجّل على حسابك — لازم واحد فعّال على الأقل لو حسابك محتاج
              MFA. Passkey جديد بيتسجّل تلقائيًا لما تحتاج تعمل login جديد بدون Passkey موجود.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {credentials === null ? (
              <TableSkeleton rows={2} columns={3} />
            ) : credentials.length === 0 ? (
              <EmptyState icon={KeyRound} title="مفيش Passkey مسجّل" description="هيتسجّل تلقائيًا لما تحتاج MFA عند تسجيل الدخول." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الجهاز</TableHead>
                    <TableHead>آخر استخدام</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((cred) => (
                    <TableRow key={cred.id}>
                      <TableCell>
                        {cred.device_label ?? 'جهاز بلا اسم'}
                        {cred.backed_up && (
                          <Badge variant="secondary" className="ms-2">
                            متزامن
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {cred.last_used_at ? new Date(cred.last_used_at).toLocaleString('ar-EG') : 'لسه ما اتستخدمش'}
                      </TableCell>
                      <TableCell className="text-end">
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive">
                              شيل
                            </Button>
                          }
                          title="تشيل الـPasskey ده؟"
                          description="لو ده آخر Passkey عندك، مش هتقدر تسجّل دخول تاني غير بكود استرجاع."
                          onConfirm={() => handleRemoveCredential(cred.id)}
                        />
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Laptop className="size-4" /> الأجهزة المسجّل دخولها
            </CardTitle>
            <CardDescription>كل جهاز عمل تسجيل دخول ناجح ولسه جلسته شغالة (refresh token صالح).</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions === null ? (
              <TableSkeleton rows={2} columns={3} />
            ) : sessions.length === 0 ? (
              <EmptyState icon={Laptop} title="مفيش جلسات مفتوحة" />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الجهاز</TableHead>
                      <TableHead>آخر ظهور</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.device_name ?? s.device_platform ?? 'جهاز غير معروف'}
                          <div className="text-xs text-muted-foreground" dir="ltr">
                            {s.ip_address ?? ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString('ar-EG') : '—'}
                        </TableCell>
                        <TableCell className="text-end">
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm" className="text-destructive">
                                إلغاء
                              </Button>
                            }
                            title="تلغي الجلسة دي؟"
                            description="الجهاز ده هيتسجّل خروجه فورًا."
                            onConfirm={() => handleRevokeSession(s.id)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 border-t pt-4">
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" className="text-destructive">
                        إلغاء كل الجلسات (بما فيهم الجلسة دي)
                      </Button>
                    }
                    title="تلغي كل الجلسات؟"
                    description="هتتسجّل خروجك من كل الأجهزة فورًا، بما فيهم الجهاز اللي بتستخدمه دلوقتي — هتحتاج تسجّل دخول تاني."
                    onConfirm={handleRevokeAll}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
