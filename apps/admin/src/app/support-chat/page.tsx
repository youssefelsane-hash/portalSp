'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminSupportThreadResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function SupportChatThreadsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [threads, setThreads] = useState<AdminSupportThreadResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<AdminSupportThreadResponseDto[]>('/admin/support-chat-threads')
      .then(setThreads)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل محادثات الدعم'));
  }, [isLoading, authedFetch]);

  return (
    <AppShell>
      <PageHeader
        title="محادثات الدعم"
        description="شات مباشر عام مع العملاء (مش مرتبط بطلب معيّن) — منفصل عن تذاكر الدعم والشكاوى."
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!threads && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
      {threads && threads.length === 0 && <p className="text-muted-foreground">مفيش محادثات دعم لسه</p>}

      {threads && threads.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>العميل</TableHead>
              <TableHead>الموبايل</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>آخر رسالة</TableHead>
              <TableHead>تاريخ الإنشاء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {threads.map((thread) => (
              <TableRow key={thread.id}>
                <TableCell>
                  <Link href={`/support-chat/${thread.id}`} className="hover:underline">
                    {thread.customer_name}
                  </Link>
                </TableCell>
                <TableCell dir="ltr" className="text-start font-mono text-xs">
                  {thread.customer_phone}
                </TableCell>
                <TableCell>
                  <Badge variant={thread.is_active ? 'default' : 'secondary'}>
                    {thread.is_active ? 'مفتوحة' : 'مقفولة'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {thread.last_message_at ? new Date(thread.last_message_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                </TableCell>
                <TableCell>{new Date(thread.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
