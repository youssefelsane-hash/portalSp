'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminSupportThreadResponseDto, MessageResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { messagesContentKey, usePinnedScroll } from '@/lib/use-pinned-scroll';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// مفيش WebSocket جوّه لوحة الأدمن (البنية التحتية للسوكيت في chat.gateway.ts مبنية للعميل/الفني
// بس) — بولينج بسيط كل 4 ثواني بدل بناء عميل Socket.IO كامل داخل Next.js لسكرين واحد.
const POLL_INTERVAL_MS = 4000;

// نفس بَقّة orders/[id]/page.tsx وtechnicians/[id]/page.tsx (2026-08-19): file_url راجع من
// LocalDiskStorageService نسبي عمداً (`/uploads/...`) — لازم أصل الباك-إند صراحة وإلا المتصفح
// بيحله على أصل صفحة الأدمن نفسها (404).
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

export default function SupportChatThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, user, authedFetch } = useAuth();
  const [thread, setThread] = useState<AdminSupportThreadResponseDto | null>(null);
  const [messages, setMessages] = useState<MessageResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // حاوية الرسايل نفسها (مش عنصر في آخرها) — التمرير التلقائي بقى مشروط بمكان المستخدم.
  const listRef = useRef<HTMLDivElement>(null);

  function loadMessages() {
    authedFetch<MessageResponseDto[]>(`/chat/threads/${id}/messages`)
      .then(setMessages)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الرسائل'));
  }

  useEffect(() => {
    if (isLoading) return;
    authedFetch<AdminSupportThreadResponseDto[]>('/admin/support-chat-threads')
      .then((rows) => setThread(rows.find((t) => t.id === id) ?? null))
      .catch(() => setThread(null));
    loadMessages();
    const interval = setInterval(loadMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً عبر AdminRealtimeGateway،
  // الصفحة دي كانت بتفوّتها فكانت محتاجة refresh يدوي.
  useAdminLiveRefresh(["support"], () => loadMessages());

  // docs/08 §63.ب3 — التمرير لآخر الشات بيحصل بس لو المستخدم أصلاً في الآخر، ومع تغيّر محتوى
  // حقيقي مش مع كل دورة polling. قبل كده كان بيخطف مكان القراءة كل بضع ثوانٍ.
  usePinnedScroll(listRef, messagesContentKey(messages));

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem('content') as HTMLInputElement;
    const content = input.value.trim();
    if (!content) return;
    setIsSending(true);
    setError(null);
    try {
      await authedFetch(`/chat/threads/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      input.value = '';
      loadMessages();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في إرسال الرسالة');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title={`محادثة الدعم — ${thread ? thread.customer_name : '…'}`}
        description={thread ? <span dir="ltr">{thread.customer_phone}</span> : undefined}
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الرسائل</CardTitle>
        </CardHeader>
        <CardContent>
          {!messages && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
          {messages && messages.length === 0 && <EmptyState title="مفيش رسائل لسه" />}

          {messages && messages.length > 0 && (
            <div ref={listRef} className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pe-1">
              {messages.map((m) => {
                const fromAdmin = m.sender_user_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${fromAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        fromAdmin ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      {m.message_type === 'image' && m.file_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.file_url.startsWith('http') ? m.file_url : `${API_ORIGIN}${m.file_url}`}
                          alt="صورة مرفقة"
                          className="max-w-full rounded"
                        />
                      ) : (
                        <p>{m.content}</p>
                      )}
                      <p className="mt-1 text-[10px] opacity-70">
                        {new Date(m.created_at).toLocaleTimeString('ar-EG-u-nu-latn')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleSend} className="mt-4 flex gap-2">
            <Input name="content" placeholder="اكتب رد…" disabled={isSending} className="flex-1" />
            <Button type="submit" disabled={isSending}>
              إرسال
            </Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
