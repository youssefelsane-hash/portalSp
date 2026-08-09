'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { InternalMessageResponseDto, InternalThreadResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// بولينج بسيط زي /support-chat/:id بالظبط — مفيش WebSocket جوّه لوحة الأدمن.
const POLL_INTERVAL_MS = 4000;

export default function InternalChatThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, user, authedFetch } = useAuth();
  const [thread, setThread] = useState<InternalThreadResponseDto | null>(null);
  const [messages, setMessages] = useState<InternalMessageResponseDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function loadMessages() {
    authedFetch<InternalMessageResponseDto[]>(`/internal-chat/threads/${id}/messages`)
      .then(setMessages)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الرسائل'));
  }

  useEffect(() => {
    if (isLoading) return;
    authedFetch<InternalThreadResponseDto[]>('/internal-chat/threads')
      .then((rows) => setThread(rows.find((t) => t.id === id) ?? null))
      .catch(() => setThread(null));
    loadMessages();
    const interval = setInterval(loadMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem('content') as HTMLInputElement;
    const content = input.value.trim();
    if (!content) return;
    setIsSending(true);
    setError(null);
    try {
      await authedFetch(`/internal-chat/threads/${id}/messages`, {
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
      <div className="mb-6">
        <h1 className="text-xl font-semibold">محادثة داخلية — {thread ? thread.peer_full_name : '…'}</h1>
        {thread && (
          <p className="text-sm text-muted-foreground">{thread.peer_user_type === 'admin' ? 'موظف' : 'فني'}</p>
        )}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الرسائل</CardTitle>
        </CardHeader>
        <CardContent>
          {!messages && !error && <p className="text-muted-foreground">جاري التحميل…</p>}
          {messages && messages.length === 0 && <p className="text-muted-foreground">مفيش رسائل لسه</p>}

          {messages && messages.length > 0 && (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pe-1">
              {messages.map((m) => {
                const fromMe = m.sender_user_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        fromMe ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <p>{m.content}</p>
                      <p className="mt-1 text-[10px] opacity-70">
                        {new Date(m.created_at).toLocaleTimeString('ar-EG-u-nu-latn')}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}

          <form onSubmit={handleSend} className="mt-4 flex gap-2">
            <Input name="content" placeholder="اكتب رسالة…" disabled={isSending} className="flex-1" />
            <Button type="submit" disabled={isSending}>
              إرسال
            </Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
