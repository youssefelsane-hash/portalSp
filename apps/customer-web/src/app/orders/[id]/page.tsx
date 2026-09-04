'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import {
  getMyOrder,
  cancelOrder,
  confirmCashHandover,
  listQuoteItems,
  approveQuoteItems,
  declineQuoteItems,
  orderStatusLabelsAr,
  customerCancellableStatuses,
  RESCHEDULABLE_ORDER_STATUSES,
  formatEgp,
  fetchCustomerCancellationReasons,
  OrderResponseDto,
  OrderItemDto,
  CancellationReasonDto,
  approveInitialQuote,
} from '@/lib/orders';
import { getThreadForOrder, listMessages, sendMessage, MessageDto } from '@/lib/chat';
import { ChatSocketClient } from '@/lib/chat-socket';
import { ApiError } from '@/lib/api-client';
import { formatWorkDuration, formatWorkforce } from '@/lib/work-scope';
import { InstallmentSection } from './installment-section';
import { RescheduleSection } from './reschedule-section';
import { RatingSection } from './rating-section';
import { WarrantyRevisitSection } from './warranty-revisit-section';

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
        <span className="text-lg font-bold">
          {order.order_status === 'awaiting_admin_quote'
            ? 'السعر قيد المراجعة'
            : order.order_status === 'awaiting_initial_quote_approval'
              ? formatEgp(order.estimated_price_cents ?? 0)
              : formatEgp(order.total_amount_cents)}
        </span>
      </div>

      {/* الخصم المطبّق — نفس سطر تطبيق العميل بالحرف. كان بيتعرض في المعاينة قبل التأكيد وبس،
          وبعد الحجز يختفي من سجل الطلب، فالعميل اللي دخّل كود خصم مكانش يقدر يتأكد إنه اتطبّق. */}
      {order.discount_amount_cents > 0 && (
        <p className="mt-1 text-sm text-success">
          الخصم المطبّق: -{formatEgp(order.discount_amount_cents)}
        </p>
      )}

      {/* تكافؤ مع تطبيق العميل (اتلقط بـ`scripts/check-contract-drift.js`): كل الأرقام دي
          راجعة في نفس الرد وكانت معروضة في التطبيق بس. أهمها `level_premium_cents` — docs/08
          §60.3 بيفرض إن زيادة سعر «الفني المميّز» تبان **بسببها مكتوب** مش كرقم بيتغيّر لوحده. */}
      {order.level_premium_cents > 0 && (
        <p className="mt-1 text-sm font-medium text-primary">
          منها {formatEgp(order.level_premium_cents)} — فني Premium
        </p>
      )}
      {order.warranty_price_cents > 0 && (
        <p className="mt-1 text-sm text-muted">
          الضمان الاختياري: {formatEgp(order.warranty_price_cents)} ضمن الإجمالي
        </p>
      )}
      {order.deposit_amount_cents !== null && order.deposit_amount_cents > 0 && (
        <p className="mt-1 text-sm text-muted">
          الإيداع المدفوع عند الحجز: {formatEgp(order.deposit_amount_cents)} — الباقي بعد ما الشغل يخلص
        </p>
      )}
      {order.price_certainty_mode === 'estimated_range' &&
        order.display_price_min_cents !== null &&
        order.display_price_max_cents !== null && (
          <p className="mt-1 text-sm text-muted">
            نطاق تقديري وقت الحجز: {formatEgp(order.display_price_min_cents)} –{' '}
            {formatEgp(order.display_price_max_cents)}
          </p>
        )}

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

      {/* رسايل الإدارة (ADR-0071، بلاغ مالك 2026-09-04) — نفس القسم بالحرف اللي في
          `apps/customer-app`'s order_detail_screen.dart. قبل كده كان النص في الإشعار بس. */}
      {order.customer_notices.map((notice) => (
        <section
          key={notice.id}
          className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4"
        >
          <h2 className="mb-1 font-semibold text-primary">
            {notice.notice_type === 'routed_to_onsite_assessment'
              ? 'الطلب اتحوّل لمعاينة في الموقع'
              : 'الإدارة طلبت تفاصيل إضافية'}
          </h2>
          <p className="text-sm leading-6">{notice.message}</p>
        </section>
      ))}

      {/* المدة المتوقعة وعدد الأفراد — نفس الصياغة المشتركة (`lib/work-scope.ts`). كانت
          معروضة في تطبيق العميل بس رغم إن الحقول راجعة في نفس الرد. */}
      {(formatWorkDuration(order.duration_minutes, order.estimated_duration_days) !== null ||
        formatWorkforce(order.required_technicians, order.required_assistants) !== null) && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-1 font-semibold">حجم الشغلانة</h2>
          <p className="text-sm text-muted">
            {[
              formatWorkDuration(order.duration_minutes, order.estimated_duration_days),
              formatWorkforce(order.required_technicians, order.required_assistants),
            ]
              .filter(Boolean)
              .join(' — ')}
          </p>
        </section>
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

      {/* بروفايل الفني وإعادة الجدولة (docs/08 §82 — توازي مع apps/customer-app) — مربوطين بس
          بـtechnician_id، مش بظهور بيانات التواصل (اسم/تليفون الفني بيظهروا بس من accepted،
          نفس order_detail_screen.dart's شرط: technicianId != null بس، صفر ربط بحالة الطلب). */}
      {order.technician_id && (
        <Link href={`/technicians/${order.technician_id}`} className="mt-4 block text-sm text-primary hover:underline">
          بروفايل الفني
        </Link>
      )}

      {order.technician_id && RESCHEDULABLE_ORDER_STATUSES.has(order.order_status) && (
        <RescheduleSection authedFetch={authedFetch} orderId={order.id} onRescheduled={setOrder} />
      )}

      {order.order_status === 'awaiting_quote_approval' && (
        <QuoteApprovalSection authedFetch={authedFetch} orderId={order.id} onResolved={refresh} />
      )}

      {order.order_status === 'awaiting_admin_quote' && (
        <section className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="font-semibold text-primary">الإدارة بتراجع الصور</h2>
          <p className="mt-1 text-sm text-muted">
            هنحدد السعر من الصور ونبعتلك إشعار. الطلب مش هيروح لأي فني قبل ما تشوف السعر وتوافق عليه.
          </p>
        </section>
      )}

      {order.order_status === 'awaiting_initial_quote_approval' && (
        <InitialQuoteApprovalSection authedFetch={authedFetch} order={order} onResolved={refresh} />
      )}

      {/* التقسيط — لو الخدمة عليها خطط متاحة، العميل يقدر يقدّم طلب (مراجعة بشر بعدها) */}
      {!['awaiting_admin_quote', 'awaiting_initial_quote_approval'].includes(order.order_status) && (
        <InstallmentSection authedFetch={authedFetch} orderId={order.id} serviceId={order.service_id} onApplied={refresh} />
      )}

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

      {/* بعد الاكتمال — نفس شرطي `apps/customer-app` بالحرف (docs/08 §128): التقييم لأي طلب
          مكتمل، وإعادة الزيارة لو الضمان لسه ساري. الاتنين كانوا مفقودين من الويب بالكامل. */}
      {order.order_status === 'completed' && <RatingSection authedFetch={authedFetch} orderId={order.id} />}

      {order.order_status === 'completed' &&
        order.warranty_expires_at !== null &&
        new Date(order.warranty_expires_at) > new Date() && (
          <WarrantyRevisitSection authedFetch={authedFetch} order={order} />
        )}

      <ChatSection authedFetch={authedFetch} orderId={order.id} accessToken={accessToken} />
    </div>
  );
}

function InitialQuoteApprovalSection({
  authedFetch,
  order,
  onResolved,
}: {
  authedFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
  order: OrderResponseDto;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRemoteQuote = order.initial_quote_source === 'admin_remote';

  async function resolve(action: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') {
        await approveInitialQuote(authedFetch, order.id);
      } else {
        await cancelOrder(authedFetch, order.id, { reason: 'العميل رفض السعر المقترح' });
      }
      onResolved();
    } catch (resolveError) {
      setError(resolveError instanceof ApiError ? resolveError.message : 'تعذّر تنفيذ الطلب، حاول تاني');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-warning bg-warning/5 p-4">
      <h2 className="font-semibold">السعر جاهز ومستني موافقتك</h2>
      <p className="mt-1 text-sm text-muted">
        {isRemoteQuote
          ? 'الإدارة حددت السعر من الصور. بعد موافقتك هنبدأ اختيار أنسب فني.'
          : 'الفني حدد السعر بعد المعاينة. راجعه قبل بدء الشغل.'}
      </p>
      {order.initial_quote_note && (
        <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">{order.initial_quote_note}</p>
      )}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-surface px-4 py-3">
        <span className="text-sm text-muted">السعر المقترح</span>
        <span className="text-xl font-bold text-primary">{formatEgp(order.estimated_price_cents ?? 0)}</span>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve('approve')}
          className="flex-1 rounded-lg bg-primary py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          موافق على السعر
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve('reject')}
          className="flex-1 rounded-lg border border-border py-2 hover:bg-surface-variant disabled:opacity-50"
        >
          رفض السعر
        </button>
      </div>
    </section>
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
    listQuoteItems(authedFetch, orderId)
      .then(setItems)
      // الفشل كان بيضيع كـunhandled rejection والقسم يفضل في حالة تحميل للأبد (docs/08 §133).
      // القايمة الفاضية بتخلّي القسم يقفل بدل ما يعلّق، والخطأ بيتسجّل للتشخيص.
      .catch((err: unknown) => {
        console.error('فشل تحميل بنود عرض السعر', err);
        setItems([]);
      });
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
    if (open && reasons === null) fetchCustomerCancellationReasons().then(setReasons)
      // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
      // والمستخدم مش عارف ليه (docs/08 §133).
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
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
          {reasons.length === 0 && (
            <p className="text-sm text-muted-foreground">اكتب سبب الإلغاء بكلامك:</p>
          )}
          {(reasons.length === 0 || (selectedReason?.requires_free_text ?? false)) && (
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
        {/* بَقّة حقيقية (docs/08 §112): الشرط كان `!selectedReasonId` على طول، فلو الأدمن
            مامعرّفش أي سبب إلغاء للعميل (وده الوضع الافتراضي — seed المشروع فيه أسباب الفني بس)
            الزرار كان بيفضل مقفول للأبد والعميل مش قادر يلغي من الويب خالص. القاعدة الصح هي
            نفس قاعدة الباك-إند بالحرف: إجباري لما يبقى فيه قايمة، ومسموح من غيره لما القايمة فاضية. */}
        <button
          disabled={busy || reasons === null || (reasons.length > 0 && !selectedReasonId)}
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
    listMessages(authedFetch, threadId)
      .then(setMessages)
      // تاريخ الرسايل فشل — السوكيت لسه هيشتغل للرسايل الجديدة، فالشات مايتعطّلش (docs/08 §133).
      .catch((err: unknown) => console.error('فشل تحميل تاريخ رسايل الشات', err));

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
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold">الشات</h2>
        {live && <span className="h-2 w-2 rounded-full bg-success" title="متصل الآن" />}
      </div>
      {/* طلب مالك صريح (docs/08 §93) — نفس السطر الموجود في تطبيق الموبايل بالحرف. */}
      <p className="mb-3 text-xs text-muted">
        اشرح مشكلتك للفني وابعتله صور قبل الزيارة — كده هيعرف يجيب العدة المناسبة معاه.
      </p>
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
