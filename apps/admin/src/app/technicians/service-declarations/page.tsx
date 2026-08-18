'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminTechnicianServiceDeclarationResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { PromptDialog } from '@/components/prompt-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { SKILL_LEVEL_LABELS } from '@/lib/technician-labels';

// طابور مراجعة تصريحات المهارات الذاتية (Script 4 §2-7) — كانت فجوة موثّقة صراحة: الفني بقى
// يقدر يصرّح بخدمة جديدة بنفسه من apps/technician-app، بس مفيش أي واجهة أدمن كانت بتعرض الطلبات
// دي أو تسمح بمراجعتها غير عبر API مباشرة. صفحة واحدة تجمّع كل التصريحات المعلّقة من كل الفنيين
// (مش لازم تدخل بروفايل كل فني لوحده) — نفس فلسفة صفحات الطوابير التانية (سجل التدقيق، الشكاوى).
export default function ServiceDeclarationsQueuePage() {
  const { isLoading, authedFetch } = useAuth();
  const [items, setItems] = useState<AdminTechnicianServiceDeclarationResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<AdminTechnicianServiceDeclarationResponseDto[]>('/admin/technicians/service-declarations')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل طابور المراجعة'));
  }, [authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);

  async function handleApprove(id: string) {
    setActingId(id);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/service-declarations/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id: string, reason: string) {
    setActingId(id);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/service-declarations/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setActingId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="طابور تصريحات المهارات"
        description="طلبات الفنيين لتقديم خدمات جديدة — كل طلب لازم اعتماد صريح قبل ما يوصله أي طلب فيها"
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {items === null ? (
        <TableSkeleton columns={5} />
      ) : items.length === 0 ? (
        <EmptyState title="مفيش طلبات مستنية المراجعة دلوقتي" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الفني</TableHead>
              <TableHead>الخدمة</TableHead>
              <TableHead>المستوى المقترح</TableHead>
              <TableHead>تاريخ الطلب</TableHead>
              <TableHead className="text-left">الإجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/technicians/${item.technician_id}`} className="text-primary hover:underline">
                    {item.technician_full_name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {item.technician_code}
                  </div>
                </TableCell>
                <TableCell>{item.service_name_ar}</TableCell>
                <TableCell>
                  <Badge variant="outline">{SKILL_LEVEL_LABELS[item.skill_level] ?? item.skill_level}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(item.created_at).toLocaleString('ar-EG')}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" disabled={actingId === item.id} onClick={() => handleApprove(item.id)}>
                      اعتماد
                    </Button>
                    <PromptDialog
                      trigger={
                        <Button size="sm" variant="destructive" disabled={actingId === item.id}>
                          رفض
                        </Button>
                      }
                      title={`رفض طلب "${item.service_name_ar}" لـ${item.technician_full_name}`}
                      label="سبب الرفض"
                      minLength={5}
                      destructive
                      confirmLabel="تأكيد الرفض"
                      onConfirm={(reason) => handleReject(item.id, reason)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
