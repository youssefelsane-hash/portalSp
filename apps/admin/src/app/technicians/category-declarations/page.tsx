'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminTechnicianCategoryDeclarationResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { PromptDialog } from '@/components/prompt-dialog';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

// طابور مراجعة تصريحات التخصص/الفئة الذاتية (§29) — بدّل طابور "المهارات" القديم اللي كان
// خدمة-بخدمة بالكامل (كانت فجوة موثّقة: كل خدمة بمفردها تحتاج تصريح وموافقة منفصلين، غير قابل
// للتوسّع — طلب مالك صريح 2026-08-20). نفس نمط الصفحة القديمة بالحرف، بس بيستهلك
// category-declarations بدل service-declarations. للتعيين المباشر من غير انتظار تصريح الفني،
// راجع كارت "التخصصات" في /technicians/[id].
export default function CategoryDeclarationsQueuePage() {
  const { isLoading, authedFetch } = useAuth();
  const [items, setItems] = useState<AdminTechnicianCategoryDeclarationResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<AdminTechnicianCategoryDeclarationResponseDto[]>('/admin/technicians/category-declarations')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل طابور المراجعة'));
  }, [authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["technicians"], () => load());

  async function handleApprove(id: string) {
    setActingId(id);
    setError(null);
    try {
      await authedFetch(`/admin/technicians/category-declarations/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
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
      await authedFetch(`/admin/technicians/category-declarations/${id}/reject`, {
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
        title="طابور تصريحات التخصصات"
        description="طلبات الفنيين للاعتماد كتخصص/فئة كاملة (سباكة، كهرباء...) — أي خدمة جديدة تتضاف تحت الفئة دي تبقى متاحة للفني تلقائيًا بعد الاعتماد"
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
              <TableHead>التخصص</TableHead>
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
                <TableCell>{item.category_name_ar}</TableCell>
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
                      title={`رفض طلب تخصص "${item.category_name_ar}" لـ${item.technician_full_name}`}
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
