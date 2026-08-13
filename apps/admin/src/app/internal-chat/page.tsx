'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { InternalContactResponseDto, InternalThreadResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function InternalChatThreadsPage() {
  const { isLoading, authedFetch } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<InternalThreadResponseDto[] | null>(null);
  const [contacts, setContacts] = useState<InternalContactResponseDto[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  function load() {
    authedFetch<InternalThreadResponseDto[]>('/internal-chat/threads')
      .then(setThreads)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل المحادثات'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    authedFetch<InternalContactResponseDto[]>('/internal-chat/contacts')
      .then(setContacts)
      .catch(() => setContacts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const peerUserId = form.get('peer_user_id') as string;
    if (!peerUserId) return;
    setIsStarting(true);
    setError(null);
    try {
      const thread = await authedFetch<InternalThreadResponseDto>('/internal-chat/threads', {
        method: 'POST',
        body: JSON.stringify({ peer_user_id: peerUserId }),
      });
      router.push(`/internal-chat/${thread.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="المحادثات الداخلية"
        description="تواصل مباشر بين الموظفين والفنيين — منفصل تماماً عن محادثات الدعم مع العملاء."
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowNew((s) => !s)}>
            + محادثة جديدة
          </Button>
        }
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      {showNew && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleStart} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <SelectNative name="peer_user_id" defaultValue="" className="min-w-64">
                  <option value="" disabled>
                    اختار موظف أو فني
                  </option>
                  {contacts.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      {c.full_name} ({c.user_type === 'admin' ? 'موظف' : 'فني'})
                    </option>
                  ))}
                </SelectNative>
              </div>
              <Button type="submit" size="sm" disabled={isStarting}>
                ابدأ المحادثة
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!threads && !error && <TableSkeleton columns={3} />}
      {threads && threads.length === 0 && <EmptyState title="مفيش محادثات لسه" />}

      {threads && threads.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الطرف التاني</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>آخر رسالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {threads.map((thread) => (
              <TableRow key={thread.id}>
                <TableCell>
                  <Link href={`/internal-chat/${thread.id}`} className="hover:underline">
                    {thread.peer_full_name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{thread.peer_user_type === 'admin' ? 'موظف' : 'فني'}</Badge>
                </TableCell>
                <TableCell>
                  {thread.last_message_at ? new Date(thread.last_message_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
