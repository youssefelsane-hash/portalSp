'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getMyOrder,
  cancelOrder,
  confirmCashHandover,
  listQuoteItems,
  approveQuoteItems,
  declineQuoteItems,
  orderStatusLabelsAr,
  customerCancellableStatuses,
  formatEgp,
  fetchCustomerCancellationReasons,
  OrderResponseDto,
  OrderItemDto,
  CancellationReasonDto,
} from '@/lib/orders';
import { getThreadForOrder, listMessages, sendMessage, MessageDto } from '@/lib/chat';
import { ChatSocketClient } from '@/lib/chat-socket';
import { ApiError } from '@/lib/api-client';
import { InstallmentSection } from './installment-section';

// ترتيب رحلة الطلب الطبيعية للعرض كخط زمني — الحالات الاستثنائية (إلغاء/نزاع) بتتعرض لوحدها.
const TIMELINE_STATUSES = [
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
  'work_completed',
  'completed',
];

const TERMINAL_BAD_STATUSES = new Set([
  'cancelled_by_customer',
  'cancelled_by_technician',
  'cancelled_by_system',
  'expired',
  'disputed',
  'refunded',
]);

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch, accessToken } = useAuth();

  const [order, setOrder] = useState<OrderResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getMyOrder(authedFetch, id)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذّر تحميل الطلب'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`/login?next=/orders/${id}`);
      return;
    }
    if (isAuthenticated) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading, id]);

  // تحديث دوري بسيط (30 ثانية) لحد ما نضيف WebSocket حقيقي للطلب في الويب — فجوة موثّقة (docs/16).
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [isAuthenticated, refresh]);

  if (authLoading || !order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        {error ? <p className="text-danger">{error}</p> : <div className="h-64 animate-pulse rounded-xl bg-surface-variant" />}
      </div>
    );
  }

  const statusLabel = orderStatusLabelsAr[order.order_status] ?? order.order_status;
  const isBad = TERMINAL_BAD_STATUSES.has(order.order_status);
  const currentStepIndex = TIMELINE_STATUSES.indexOf(order.order_status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">طلب #{order.order_number}</h1>
          <p className={`mt-1 font-medium ${isBad ? 'text-danger' : 'text-primary'}`}>{statusLabel}</p>
        </div>
        <span className="text-lg font-bold">{formatEgp(order.total_amount_cents)}</span>
      </div>

      {!isBad && currentStepIndex >= 0 && (
        <ol className="mt-6 space-y-2">
          {TIMELINE_STATUSES.map((s, i) => (
            <li key={s} className={`flex items-center gap-3 ${i <= currentStepIndex ? 'text-fg' : 'text-muted'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${i <= currentStepIndex ? 'bg-primary' : 'bg-border'}`} />
              {orderStatusLabelsAr[s]}
            </li>
          ))}
        </ol>
      )}

      {order.address && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-1 font-semibold">العنوان</h2>
          <p className="text-sm text-muted">{order.address.street_name}</p>
          {order.address.landmark && <p className="text-sm text-muted">{order.address.landmark}</p>}
        </section>
      )}

      {order.technician_name && (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-1 font-semibold">الفني</h2>
          <p>{order.technician_name}</p>
          {order.technician_phone && (
            <a href={`tel:${order.technician_phone}`} dir="ltr" className="text-primary hover:underline">
              {order.technician_phone}
            </a>
          )}
        </section>
      )}

      {order.order_status === 'awaiting_quote_approval' && (
        <QuoteApprovalSection authedFetch={authedFetch} orderId={order.id} onResolved={refresh} />
      )}

      {/* التقسيط — لو الخدمة عليها خطط متاحة، العميل يقدر يقدّم طلب (مراجعة بشر بعدها) */}
      <InstallmentSection authedFetch={authedFetch} orderId={order.id} serviceId={order.service_id} onApplied={refresh} />

      {order.payment_status !== 'paid' && order.order_status === 'work_completed' && !order.customer_cash_confirmed_at && (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <p className="mb-3">الفني خلّص الشغل — أكّد إنك استلمت وسلّمت الكاش للفني.</p>
          <button
            onClick={() => confirmCashHandover(authedFetch, order.id).then(setOrder)}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
          >
            أكّد استلام الشغل وتسليم الكاش
          </button>
        </section>
      )}

      {customerCancellableStatuses.has(order.order_status) && (
        <CancelSection authedFetch={authedFetch} orderId={order.id} onCancelled={setOrder} />
      )}

      <ChatSection authedFetch={authedFetch} orderId={order.id} accessToken={accessToken} />
    </div>
  );
}

function QuoteApprovalSection({
  authedFetch,
  orderId,
  onResolved,
}: {
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  orderId: string;
  onResolved: () => void;
}) {
  const [items, setItems] = useState<OrderItemDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listQuoteItems(authedFetch, orderId).then(setItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const pending = items?.filter((i) => i.proposal_status === 'pending') ?? [];
  const addedTotal = pending.reduce((sum, i) => sum + i.total_price_cents, 0);

  return (
    <section className="mt-4 rounded-xl border border-warning bg-warning/5 p-4">
      <h2 className="mb-2 font-semibold">الفني اقترح شغل إضافي — يحتاج موافقتك</h2>
      {items === null ? (
        <div className="h-16 animate-pulse rounded-lg bg-surface-variant" />
      ) : pending.length === 0 ? (
        <p className="text-sm text-muted">مفيش عناصر مستنية موافقة حاليًا</p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {pending.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span>
                  {i.name_ar} × {i.quantity}
                </span>
                <span>{formatEgp(i.total_price_cents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between font-semibold">
            <span>الإضافة</span>
            <span>{formatEgp(addedTotal)}</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await approveQuoteItems(authedFetch, orderId).catch(() => null);
                setBusy(false);
                onResolved();
              }}
              className="flex-1 rounded-lg bg-primary py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              موافق
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await declineQuoteItems(authedFetch, orderId).catch(() => null);
                setBusy(false);
                onResolved();
              }}
              className="flex-1 rounded-lg border border-border py-2 hover:bg-surface-variant disabled:opacity-50"
            >
              رفض
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CancelSection({
  authedFetch,
  orderId,
  onCancelled,
}: {
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  orderId: string;
  onCancelled: (order: OrderResponseDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<CancellationReasonDto[] | null>(null);
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && reasons === null) fetchCustomerCancellationReasons().then(setReasons);
  }, [open, reasons]);

  const selectedReason = reasons?.find((r) => r.id === selectedReasonId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const order = await cancelOrder(authedFetch, orderId, {
        cancellation_reason_id: selectedReasonId ?? undefined,
        reason: freeText || undefined,
      });
      onCancelled(order);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إلغاء الطلب');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 text-sm text-danger hover:underline">
        إلغاء الطلب
      </button>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 font-semibold">ليه عايز تلغي الطلب؟</h2>
      {reasons === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-surface-variant" />
      ) : (
        <div className="space-y-2">
          {reasons.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input type="radio" name="cancel-reason" checked={selectedReasonId === r.id} onChange={() => setSelectedReasonId(r.id)} />
              <span>{r.reason_ar}</span>
              {r.charges_fee && <span className="text-xs text-warning">(ممكن رسوم إلغاء)</span>}
            </label>
          ))}
          {(selectedReason?.requires_free_text ?? false) && (
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              maxLength={500}
              placeholder="اكتب السبب بالتفصيل"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2"
            />
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          disabled={busy || !selectedReasonId}
          onClick={submit}
          className="rounded-lg bg-danger px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2">
          تراجع
        </button>
      </div>
    </section>
  );
}

function ChatSection({
  authedFetch,
  orderId,
  accessToken,
}: {
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  orderId: string;
  accessToken: string | null;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const clientRef = useRef<ChatSocketClient | null>(null);

  useEffect(() => {
    // بَقّة حقيقية اتلقطت باختبار حي: مفيش thread للطلب لسه (قبل تعيين فني، أو طلب اتلغى قبل ما
    // يتعيّنله فني خالص) بيرجع 404 متوقّع من الباك-إند — ده مش خطأ يستاهل console noise، ببساطة
    // مفيش شات نعرضه (الشرط `if (!threadId) return null` تحت بيتعامل معاه بصمت).
    getThreadForOrder(authedFetch, orderId)
      .then((t) => setThreadId(t.id))
      .catch(() => setThreadId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // شات حي عبر WebSocket (نفس القناة اللي الموبايل بيستخدمها بالضبط، chat.gateway.ts) — تاريخ
  // الرسايل بـREST مرة واحدة، الرسايل الجديدة بتوصل فورًا عبر السوكيت بدل بولينج (كان فجوة موثّقة).
  useEffect(() => {
    if (!threadId || !accessToken) return;
    listMessages(authedFetch, threadId).then(setMessages);

    const client = new ChatSocketClient();
    clientRef.current = client;
    client.connect({
      accessToken,
      threadId,
      onJoined: () => setLive(true),
      onMessageReceived: (msg) => setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])),
      onError: () => setLive(false),
    });

    return () => {
      client.disconnect();
      clientRef.current = null;
      setLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, accessToken]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!threadId || !text.trim()) return;
    const content = text.trim();
    setSending(true);
    try {
      if (live && clientRef.current) {
        // عبر السوكيت — الرسالة هترجع تاني عبر chat:message_received (بث للغرفة كلها بما فيها
        // المرسل نفسه)، فمش محتاجين نضيفها للـstate يدويًا هنا (تجنّب تكرارها).
        clientRef.current.sendMessage(threadId, content);
      } else {
        const msg = await sendMessage(authedFetch, threadId, content);
        setMessages((prev) => [...prev, msg]);
      }
      setText('');
    } finally {
      setSending(false);
    }
  }

  if (!threadId) return null;

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold">الشات</h2>
        {live && <span className="h-2 w-2 rounded-full bg-success" title="متصل الآن" />}
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">مفيش رسايل لسه</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="rounded-lg bg-surface-variant px-3 py-2 text-sm">
              {m.content}
            </div>
          ))
        )}
      </div>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب رسالة..."
          maxLength={2000}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          إرسال
        </button>
      </form>
    </section>
  );
}
