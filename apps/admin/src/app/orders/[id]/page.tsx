'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type {
  AdminTechnicianResponseDto,
  ComplaintResponseDto,
  OrderDetailResponseDto,
  OrderEarningShareResponseDto,
  OrderFinancialSummaryResponseDto,
  OrderItemResponseDto,
  DispatchRouteDto,
  ExplainCandidateRelationDto,
  OrderMatchingFunnelDto,
  OrderRatingResponseDto,
  OrderTraceDto,
  OrderTraceResponseDto,
  OrderMediaResponseDto,
  OrderTimelineEventResponseDto,
  RemoveCrewMemberResponseDto,
  TeamMemberResponseDto,
  TechnicianCapacityTier,
  TechnicianEligibilityExplanationDto,
} from '@baytak/shared-types';
import { formatWorkDuration, formatWorkforce } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { OrderEarningAdjustmentsSection } from './order-earning-adjustments-section';
import { resolveMediaUrl } from '@/lib/media-url';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';

const MEDIA_TYPE_LABELS: Record<string, string> = {
  before_photo: 'قبل الشغل',
  after_photo: 'بعد الشغل',
  problem_photo: 'صورة المشكلة',
  receipt: 'إيصال',
  signature: 'توقيع',
  video: 'فيديو',
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  service: 'خدمة',
  addon: 'إضافة',
  spare_part: 'قطعة غيار',
  extra_labor: 'أجرة إضافية',
};

const EARNING_SHARE_ROLE_LABELS: Record<OrderEarningShareResponseDto['participant_role'], string> = {
  leader: 'قائد الطاقم',
  team_member: 'فني ضمن الطاقم',
  assistant: 'مساعد',
};

// GET /admin/orders/:id/reschedule-options (ADR-0034) — يوم + هل الفني المعيّن متاح فيه فعلاً.
interface RescheduleOptionDto {
  date: string;
  available: boolean;
}

interface EligibleAssistantDto {
  technician_id: string;
  full_name: string;
  technician_code: string;
  current_level: string;
  distance_km: string | null;
  // docs/08 §108-A — كانت غايبة عن الواجهة رغم إن الباك-إند بيرجّعها من زمان (ADR-0057):
  // بدونها الأدمن معندوش أي مؤشر قبل الاختيار إن الفني ده مشغول وهيتحوّل لعرض/فرصة بدل إضافة
  // فورية.
  capacity_tier: TechnicianCapacityTier;
}

// docs/08 §108-A — شكل رد assignAssistant/addCrewMember بعد ADR-0057: مش الطلب كامل زي الأول،
// بقى discriminated union يوضّح هل الإضافة كانت فورية ولا اتحوّلت لفرصة تحتاج قبول الفني.
interface CrewAssignResponseDto {
  status: 'assigned' | 'offer_sent';
  capacity_tier?: TechnicianCapacityTier;
}

// ملاحظات داخلية لمركز الاتصال (docs/08 §73 بند 3): GET/POST /admin/orders/:id/notes.
interface OrderInternalNoteResponseDto {
  id: string;
  order_id: string;
  author_user_id: string;
  author_full_name?: string;
  note: string;
  created_at: string;
}

// شكاوى/ضمان مرتبطين بالطلب (docs/08 §73 بند 3 المؤجّل — الجزء ده اتفعّل) — GET /admin/warranty-claims?order_id=.
interface OrderWarrantyClaimSummaryDto {
  id: string;
  status: string;
  defect_description: string;
  created_at: string;
}
import { AppShell, useAdminBack } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  BOOKING_MODE_LABELS,
  orderStatusTone,
  PAYMENT_STATUS_LABELS,
  paymentStatusTone,
  isOrderCancellable,
  isOrderReassignable,
  orderCancelBlockedReason,
  orderRescheduleBlockedReason,
  TIMELINE_SOURCE_LABELS,
  timelineEventSourceTone,
  DISPATCH_ROUTE_LABELS,
  dispatchRouteBadgeClass,
} from '@/lib/order-labels';
import {
  PAYMENT_GATEWAY_STATUS_LABELS,
  PAYMENT_METHOD_LABELS_FULL,
  REFUND_METHOD_LABELS,
  REFUND_STATUS_LABELS,
} from '@/lib/payments-labels';
import { COMPLAINT_STATUS_LABELS, complaintStatusTone } from '@/lib/support-labels';
import {
  CAPACITY_TIER_LABELS,
  LEVEL_LABELS,
  capacityTierBadgeClass,
  technicianKindOptionPrefix,
  type TechnicianKindCode,
} from '@/lib/technician-labels';
import { TechnicianKindTag } from '@/components/technician-kind-tag';
import { formatDateTimeAr, formatEgp  } from '@/lib/format';
import { ErrorNotice, Notice } from '@/components/notice';
import { DataList, DataRow, DataBlock } from '@/components/data-list';
import { FORMATION_STAGE_KEYS, type OrderPriceTrail } from '@/lib/order-price-trail';

/** إصدار عرض سعر كما بيرجّعه `GET /admin/orders/:id/quotes`. */
interface AdminOrderQuote {
  id: string;
  version: number;
  source: string;
  status: string;
  amount_cents: number;
  diagnosis: string | null;
  revision_reason: string | null;
  expected_max_cents: number | null;
  valid_until: string;
  created_at: string;
  admin_decided_at: string | null;
  customer_decided_at: string | null;
}

const QUOTE_STATUS_LABELS: Record<string, string> = {
  pending_admin_review: 'مستني مراجعة الإدارة',
  pending_customer: 'مستني العميل',
  approved: 'معتمد',
  rejected: 'مرفوض',
  expired: 'منتهي الصلاحية',
  superseded: 'اتبدل بعرض أحدث',
};

const QUOTE_SOURCE_LABELS: Record<string, string> = {
  admin_remote: 'الإدارة — من الصور',
  technician_onsite: 'الفني — بعد المعاينة',
  technician_diagnosis: 'الفني — بعد التشخيص',
};

const TRACE_STATUS_LABELS: Record<string, string> = {
  sent: 'مُرسل',
  viewed: 'تمت المشاهدة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  timeout: 'انتهت المهلة',
  cancelled: 'ملغي',
};

const TRACE_NEXT_ACTION_LABELS: Record<OrderTraceDto['next_action'], string> = {
  waiting_technician_response: 'مستني رد الفنيين',
  expand_next_round: 'المفروض يوسّع لجولة جديدة',
  matching_exhausted: 'الجولات خلصت بلا قبول',
  assigned: 'اتعيّن على فني',
  no_matching_required: 'مش في مرحلة بحث',
};

/**
 * مجموعات قايمة «ليه/ليه لأ» بترتيب **قرب الشخص من الطلب** (docs/08 §167).
 *
 * الترتيب هنا هو الإجابة على بلاغ المالك: «لما الطلب بيروح لصنايعي معين بلاقي إن بتاعه مش
 * شغال» — الشخص اللي على الطلب لازم يكون أول اسم يشوفه، مش مدفون في مجمّع المدينة (أو غايب منه).
 */
const EXPLAIN_RELATION_GROUPS: { relation: ExplainCandidateRelationDto; label: string }[] = [
  { relation: 'assigned', label: 'متعيّن على الطلب ده' },
  { relation: 'crew', label: 'في طاقم الطلب ده' },
  { relation: 'offered', label: 'اتعرض عليه الطلب ده' },
  { relation: 'city_pool', label: 'معتمدين في مدينة الطلب' },
];

/** وقت قصير في سطر واحد — الجدول ده جوّه كارت، فالتاريخ الكامل بياخد عرض من غير فايدة. */
function traceTime(value: string | null): string {
  if (!value) return '—';
  // بلا عزل ثنائي اتجاه عمدًا: `ar-EG` بيحقن RLM بين الأجزاء بنفسه وده اللي بيظبط العرض جوّه
  // صفحة RTL؛ لفّه في `\u2066…\u2069` بيكسره (اتأكدت بتجربة عملية بمتصفح حقيقي).
  return new Date(value).toLocaleString('ar-EG-u-nu-latn', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * ليه الطلب ده مالوش جولات توزيع — بالاسم، مش «يا إما… يا إما».
 *
 * المالك سأل بالنص: «عايز حتى لو الطلب راح للشخص على طول exception يلاقيه أو شايف، عايز أبقى
 * فاهم السيستم بيتصرف إزاي من كل طلب». الرسالة القديمة كانت بتعدّد احتمالين وتسيبه يخمّن؛
 * دي بتقرا حالة الطلب ومسار التوزيع اللي الباك-إند حسبه وتقول الحاصل فعلاً.
 */
function noRoundsReasonAr(order: OrderDetailResponseDto | null, dispatchRoute: DispatchRouteDto | null): string {
  if (order?.technician_id) {
    return dispatchRoute === 'auto_confirm'
      ? 'اتعيّن على الفني مباشرةً (تأكيد تلقائي) من غير ما يتعرض على حد ولا ينتظر قبوله.'
      : 'فيه فني متعيّن عليه خلاص، والتعيين اتم من غير جولات عرض (تعيين إداري/مباشر).';
  }
  if (dispatchRoute === 'not_dispatchable') {
    return 'الطلب مش في مرحلة توزيع أصلاً (حالته الحالية مش بتدوّر على فني).';
  }
  if (dispatchRoute === 'auto_confirm') {
    return 'مساره تأكيد تلقائي — أول فني مؤهّل هياخده على طول من غير جولات عرض.';
  }
  return 'لسه ما دخلش التوزيع — أول جولة لسه ما اتبعتتش.';
}

/**
 * جولات المطابقة للطلب — توسيع للعدّادات المسطّحة اللي فوقه في نفس الكارت، مش قسم منفصل.
 *
 * بيقرا `GET /admin/operations/order-traces/:id` (نفس `order_assignments`). صفر منطق مطابقة هنا.
 */
function OrderTraceRounds({
  trace,
  error,
  order,
  dispatchRoute,
}: {
  trace: OrderTraceDto | null;
  error: string | null;
  order: OrderDetailResponseDto | null;
  dispatchRoute: DispatchRouteDto | null;
}) {
  /*
    **الغياب بيتشرح، مابيحصلش بصمت** (بلاغ مالك 2026-09-18/19).

    الجدول ده كان بيرجّع `null` في تلات حالات مختلفة تمامًا — نداء فشل، طلب مالوش جولات،
    وطلب اتعيّن يدويًا — والتلاتة بيدّوا نفس النتيجة على الشاشة: **مفيش حاجة**. فالأدمن اللي
    شاف الجدول على طلب وما شافهوش على طلب تاني بيستنتج إن الميزة «اتشالت». دلوقتي كل حالة
    بتقول نفسها **بالاسم** — بما فيها حالة «راح للفني على طول» اللي المالك سأل عنها بالنص.
  */
  if (error) {
    return (
      <p className="mt-3 text-xs text-destructive">
        مش قادرين نحمّل جولات التوزيع دلوقتي ({error}) — العدّادات فوق لسه صحيحة.
      </p>
    );
  }
  if (!trace || trace.rounds.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        مفيش جولات توزيع على الطلب ده — {noRoundsReasonAr(order, dispatchRoute)}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">
          جولة {trace.current_round} من {trace.max_rounds}
        </Badge>
        <StatusChip tone={trace.next_action === 'expand_next_round' || trace.next_action === 'matching_exhausted' ? 'danger' : 'neutral'}>
          {TRACE_NEXT_ACTION_LABELS[trace.next_action]}
        </StatusChip>
        {/* «مفيش تأخير» معلومة زي «متأخر ٥ دقايق» — إخفاؤها بيخلي الأدمن مش عارف
            إذا كان المقياس اتحسب أصلاً ولا لأ. */}
        {trace.delay_seconds > 0 ? (
          <span className="text-destructive">متأخر {Math.floor(trace.delay_seconds / 60)} دقيقة</span>
        ) : (
          <span className="text-muted-foreground">مفيش تأخير</span>
        )}
      </div>

      {trace.rounds.map((round) => (
        <div key={round.round}>
          <p className="mb-1 text-xs text-muted-foreground">
            جولة {round.round} — بدأت {traceTime(round.started_at)} · مهلة التوسيع {traceTime(round.expansion_due_at)}
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفني</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>اتبعت</TableHead>
                  <TableHead>فتح العرض</TableHead>
                  <TableHead>ردّ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {round.technicians.map((t) => (
                  <TableRow key={t.assignment_id}>
                    <TableCell className="text-xs">
                      <Link href={`/technicians/${t.technician_id}`} className="hover:underline">
                        {t.full_name}
                      </Link>
                      {t.distance_km !== null && (
                        <span className="text-muted-foreground"> · {t.distance_km.toFixed(1)} كم</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {TRACE_STATUS_LABELS[t.status] ?? t.status}
                      {t.rejection_reason_code && <div className="text-[10px] text-muted-foreground">{t.rejection_reason_code}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{traceTime(t.sent_at)}</TableCell>
                    {/* الفرق بين «ما ردّش» و«ما فتحش أصلاً» (order_assignments.viewed_at، migration 0255). */}
                    <TableCell className="whitespace-nowrap text-xs">{traceTime(t.viewed_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{traceTime(t.responded_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * صف دفعة قابلة للاسترداد مع المتبقي منها فعليًا.
 *
 * القاعدة هنا **نسخة حرفية** من `PaymentsService.refundOrder()`: الدفعة قابلة للاسترداد لو
 * حالتها `succeeded` أو `partially_refunded`، والمحجوز منها هو مجموع الاستردادات `completed`
 * **و`processing`** — الـ`processing` حجز حقيقي مش تقدير، لأن نتيجة البوابة لسه غير مؤكدة
 * وممكن تكون الفلوس خرجت بالفعل. الترتيب بالأحدث زي الباك-إند بالظبط.
 */
type RefundablePaymentRow = {
  payment: OrderFinancialSummaryResponseDto['payments'][number];
  refundedCents: number;
  remainingCents: number;
};

function refundablePaymentsOf(summary: OrderFinancialSummaryResponseDto | null): RefundablePaymentRow[] {
  if (!summary) return [];
  const reservedByPayment = new Map<string, number>();
  for (const refund of summary.refunds) {
    if (refund.refund_status !== 'completed' && refund.refund_status !== 'processing') continue;
    reservedByPayment.set(refund.payment_id, (reservedByPayment.get(refund.payment_id) ?? 0) + refund.amount_cents);
  }
  return summary.payments
    .filter((payment) => payment.payment_status === 'succeeded' || payment.payment_status === 'partially_refunded')
    .map((payment) => {
      const refundedCents = reservedByPayment.get(payment.id) ?? 0;
      return { payment, refundedCents, remainingCents: payment.amount_cents - refundedCents };
    })
    .sort((a, b) => (b.payment.completed_at ?? '').localeCompare(a.payment.completed_at ?? ''));
}

/**
 * وسم اختياري: `order_item_batch_id` بيتملي **بس** في مسار الخصم التلقائي بالكارت
 * (`attemptAdditionalWorkCharge`). دفعة الزيادة المدفوعة بـInstaPay بتيجي بلا batch، فلو
 * سمّينا اللي بلا batch «الدفعة الأساسية» هنكدب على الأدمن في أكتر حالة شائعة. الفاضي = بلا
 * وسم، والتمييز بيبقى برقم الدفعة والمبلغ والتاريخ.
 */
function refundPaymentKindLabel(payment: OrderFinancialSummaryResponseDto['payments'][number]): string {
  return payment.order_item_batch_id ? 'شغل إضافي معتمد' : '';
}

/**
 * رقم الدفعة أول حاجة عمدًا: دفعات الطلب الواحد بتبقى غالبًا بنفس الوسيلة وفي نفس اليوم
 * (الأساسية + الزيادات المعتمدة)، فرقم الدفعة هو التمييز الوحيد المضمون، وهو نفسه اللي بيبان
 * في سجل تحويلات InstaPay فالأدمن يقدر يطابق بينهم.
 */
function refundPaymentOptionLabel(row: RefundablePaymentRow): string {
  const when = row.payment.completed_at ? new Date(row.payment.completed_at).toLocaleDateString('ar-EG') : 'بلا تاريخ تحصيل';
  const alreadyRefunded = row.refundedCents > 0 ? ` · اترد منها ${formatEgp(row.refundedCents)}` : '';
  const kind = refundPaymentKindLabel(row.payment);
  return `${row.payment.payment_number}${kind ? ` · ${kind}` : ''} · ${PAYMENT_METHOD_LABELS_FULL[row.payment.payment_method]} · ${when} · متبقٍ ${formatEgp(row.remainingCents)} من ${formatEgp(row.payment.amount_cents)}${alreadyRefunded}`;
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch, authedFetchPaginated, hasPermission } = useAuth();
  // رجوع حقيقي بيحافظ على حالة القايمة (docs/08 §63.ب6) بدل router.push اللي كان بيضيّعها.
  const goBack = useAdminBack('/orders');

  const [order, setOrder] = useState<OrderDetailResponseDto | null>(null);
  const [priceTrail, setPriceTrail] = useState<OrderPriceTrail | null>(null);
  const [financialSummary, setFinancialSummary] = useState<OrderFinancialSummaryResponseDto | null>(null);
  const [earningShares, setEarningShares] = useState<OrderEarningShareResponseDto[] | null>(null);
  const [earningSharesError, setEarningSharesError] = useState(false);

  /**
   * قابل لإعادة النداء عمدًا: بعد إضافة/إلغاء استثناء على الطلب، الحصص المعروضة (وهي معاينة
   * حيّة من نفس محرك التسوية قبل الإقفال) لازم تتحدّث فورًا — وإلا الأدمن يعدّل ويشوف الأرقام
   * القديمة ويفتكر إن التعديل مامشيش.
   */
  const loadEarningShares = useCallback(() => {
    setEarningSharesError(false);
    authedFetch<OrderEarningShareResponseDto[]>(`/admin/orders/${id}/earning-shares`)
      .then(setEarningShares)
      .catch(() => {
        setEarningShares([]);
        setEarningSharesError(true);
      });
  }, [authedFetch, id]);

  /**
   * المشاركون المسموح لهم باستثناء على الطلب — **من الحصص نفسها**، مش من قايمة فنيين عامة.
   * الباك-إند بيرفض أي حد مش مشارك، فالقايمة دي بتمنع الاختيار الغلط من الأصل بدل ما الأدمن
   * يكتشفه برسالة رفض.
   */
  const adjustmentParticipants = (earningShares ?? []).map((share) => ({
    technician_id: share.technician_id,
    full_name: share.full_name,
    role_label: EARNING_SHARE_ROLE_LABELS[share.participant_role],
  }));
  const [media, setMedia] = useState<OrderMediaResponseDto[]>([]);
  const [ratings, setRatings] = useState<OrderRatingResponseDto[]>([]);
  // بند 8 — إصدارات عرض السعر. الـendpoint كان موجود من غير أي شاشة بتقراه.
  const [quotes, setQuotes] = useState<AdminOrderQuote[]>([]);
  const [quoteDecisionReason, setQuoteDecisionReason] = useState('');
  const [reissueEgp, setReissueEgp] = useState('');
  const [quoteItems, setQuoteItems] = useState<OrderItemResponseDto[]>([]);
  const [timeline, setTimeline] = useState<OrderTimelineEventResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showReassignForm, setShowReassignForm] = useState(false);
  const [technicianId, setTechnicianId] = useState('');
  const [approvedTechnicians, setApprovedTechnicians] = useState<AdminTechnicianResponseDto[] | null>(null);
  // ADR-0017 بند 4 — قايمة مستقلة لاستبدال/تعيين الفني الأساسي بس (reassign)، مبنية على نفس
  // منطق الأهلية الحقيقي لهذا الطلب بالذات (خدمة/منطقة/موعد)، بديل عن approvedTechnicians العامة
  // فوق (لسه مستخدمة زي ما هي لإضافة/استبدال عضو فريق ومساعد — نطاق مختلف).
  const [eligibleReassignTechnicians, setEligibleReassignTechnicians] = useState<
    { technicianId: string; fullName: string; technicianKind: TechnicianKindCode }[] | null
  >(null);
  // docs/08 §107 — مفتّش المطابقة له مصدر مرشّحين **منفصل** عن قايمة التعيين فوق. القايمة دي
  // بتشمل غير المؤهّل عمدًا: سؤال «ليه ده مش مختار؟» مستحيل يتسأل لو اللي إجابته «لأ» متشال من
  // القايمة اللي بتختار منها (وده اللي كان بيخفي المساعدين الجداد خالص — بلاغ المالك).
  const [explainCandidates, setExplainCandidates] = useState<
    {
      technicianId: string;
      fullName: string;
      technicianKind: TechnicianKindCode;
      currentLevel: string | null;
      isEligibleNow: boolean;
      relationToOrder: ExplainCandidateRelationDto;
    }[] | null
  >(null);
  /** الغياب بيتشرح: نداء فاشل ≠ «مفيش مرشّحين» (docs/08 §167). */
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesScopeNote, setCandidatesScopeNote] = useState<string | null>(null);
  const [showAdjustPriceForm, setShowAdjustPriceForm] = useState(false);
  const [newTotalEgp, setNewTotalEgp] = useState('');
  const [adjustPriceReason, setAdjustPriceReason] = useState('');
  const [photoQuoteEgp, setPhotoQuoteEgp] = useState('');
  const [photoQuoteNote, setPhotoQuoteNote] = useState('');
  // بند 8 — القرارات اللي مش تسعير: الصور مش كفاية، أو ناقص معلومات.
  const [triageReason, setTriageReason] = useState('');
  const [infoRequest, setInfoRequest] = useState('');
  const [triageOutcome, setTriageOutcome] = useState<string | null>(null);
  const [uploadingProblemImages, setUploadingProblemImages] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMemberResponseDto[]>([]);
  const [showAssignAssistantForm, setShowAssignAssistantForm] = useState(false);
  const [assistantTechnicianId, setAssistantTechnicianId] = useState('');
  const [eligibleAssistants, setEligibleAssistants] = useState<EligibleAssistantDto[] | null>(null);
  // docs/08 §108-A — بعد ADR-0057، الإضافة ممكن تتحوّل لعرض/فرصة بدل إضافة فورية لو الفني مشغول
  // (نفس منطق التجنيد الذاتي في apps/technician-app بالحرف). الأدمن كان بياخد نفس رسالة النجاح
  // في الحالتين، بلا أي تمييز إن الفني اتضاف فعلاً ولا لسه مستني يقبل عرض.
  const [crewAssignOutcome, setCrewAssignOutcome] = useState<{ message: string; isOffer: boolean } | null>(null);
  const [showCancelWithFeeForm, setShowCancelWithFeeForm] = useState(false);
  const [visitFeeEgp, setVisitFeeEgp] = useState('');
  const [failedVisitNotes, setFailedVisitNotes] = useState('');
  // حل زيارة فاشلة يستعمل نفس أيام الإتاحة الحقيقية لإعادة الجدولة العامة. الـslots اليدوية
  // اختيارية في النظام، لذلك لا يجوز أن تكون شرطًا لاستكمال طلب العميل.
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [failedVisitRescheduleOptions, setFailedVisitRescheduleOptions] = useState<RescheduleOptionDto[] | null>(null);
  const [failedVisitRescheduleDate, setFailedVisitRescheduleDate] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');
  const [showCashDisputeConfirmForm, setShowCashDisputeConfirmForm] = useState(false);
  const [cashDisputeNotes, setCashDisputeNotes] = useState('');
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundAmountEgp, setRefundAmountEgp] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [reconcilingRefundId, setReconcilingRefundId] = useState<string | null>(null);
  const [refundReconciliationOutcome, setRefundReconciliationOutcome] = useState<'confirmed' | 'rejected'>('confirmed');
  const [refundProviderReference, setRefundProviderReference] = useState('');
  const [refundReconciliationEvidence, setRefundReconciliationEvidence] = useState('');
  const [rejectInstaPayPaymentId, setRejectInstaPayPaymentId] = useState<string | null>(null);
  const [rejectInstaPayReason, setRejectInstaPayReason] = useState('');

  // إدارة طاقم الطلب من الأدمن (Script 4 §22-29, §38-41) — منفصل عن teamMembers/المساعدين فوق
  // (member_type='assistant')، ده للأعضاء العاديين (member_type='team_member') في طلب "اعتماد".
  const [showAddCrewForm, setShowAddCrewForm] = useState(false);
  const [crewTechnicianId, setCrewTechnicianId] = useState('');
  const [crewRoleLabel, setCrewRoleLabel] = useState('');
  // docs/08 §70 — نوع العضو (فني/مساعد) هو اللي بتتحسب منه حالة "الطاقم ناقص"، مش نص الدور.
  const [crewMemberType, setCrewMemberType] = useState<'team_member' | 'assistant'>('team_member');
  const [removingCrewMemberId, setRemovingCrewMemberId] = useState<string | null>(null);
  const [removeCrewReason, setRemoveCrewReason] = useState('');
  const [replacingCrewMemberId, setReplacingCrewMemberId] = useState<string | null>(null);
  const [replaceCrewTechnicianId, setReplaceCrewTechnicianId] = useState('');
  const [replaceCrewReason, setReplaceCrewReason] = useState('');
  const [replaceCrewRoleLabel, setReplaceCrewRoleLabel] = useState('');
  const [crewShortageWarning, setCrewShortageWarning] = useState(false);

  // إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — بعكس فورم إعادة الجدولة فوق (مقصور على
  // outcome='reschedule' بتاع resolve-failed-visit)، ده لأي طلب reschedulable بغض النظر عن أي
  // زيارة فاشلة. state منفصل عمدًا عشان الفورمين يفضلوا مستقلين (سياقين مختلفين تمامًا).
  const [showAdminRescheduleForm, setShowAdminRescheduleForm] = useState(false);
  // ADR-0034 — أيام حقيقية من محرك التوافر الموحّد، مش صفوف سلوت. القايمة القديمة كانت بترجع
  // فاضية دايمًا بعد ما النموذج اتقلب لـopt-out (ADR-0017): غياب الصف = متاح، فمفيش صفوف تتعرض.
  const [adminRescheduleOptions, setAdminRescheduleOptions] = useState<RescheduleOptionDto[] | null>(null);
  const [adminRescheduleDate, setAdminRescheduleDate] = useState('');
  // أقرب يوم مسموح لإعادة الجدولة (بكرة). `useState` بمُهيّئ كسول لأن `Date.now()` جوّه الرندر
  // مباشرةً غير نقي — `react-hooks/purity` كان بيرفضه، والنتيجة كانت بتتحسب من جديد مع كل رندر.
  const [minRescheduleDate] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [adminRescheduleReason, setAdminRescheduleReason] = useState('');
  // مفتّش المطابقة (docs/08 §36.5) — واجهة فوق MatchingExplainabilityService الموجود بالفعل
  // (§35.7/§35.8)، صفر خوارزمية تشخيصية موازية. funnelError متوقّع/هادئ لطلبات بلا service_zone_id
  // (400 من الباك-إند نفسه — مش كل الطلبات القديمة عندها نطاق محدد).
  const [matchingFunnel, setMatchingFunnel] = useState<OrderMatchingFunnelDto | null>(null);
  // تتبّع جولات المطابقة — نفس order_assignments اللي الفانل بيعدّها، بس مجمّعة بالجولة والفني.
  const [orderTrace, setOrderTrace] = useState<OrderTraceDto | null>(null);
  /** سبب غياب جولات التوزيع — `catch` صامت كان بيخلّي فشل النداء يبان زي «مفيش بيانات». */
  const [traceError, setTraceError] = useState<string | null>(null);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [explainTechnicianId, setExplainTechnicianId] = useState('');
  const [explanation, setExplanation] = useState<TechnicianEligibilityExplanationDto | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  // ملاحظات داخلية لمركز الاتصال (docs/08 §73 بند 3) — مش شات/رسالة عادية، العميل/الفني
  // مالهومش أي وصول لها خالص.
  const [internalNotes, setInternalNotes] = useState<OrderInternalNoteResponseDto[]>([]);
  // شكاوى/ضمان مرتبطين بالطلب (docs/08 §73 بند 3 المؤجّل) — عرض بس، الإجراءات نفسها في شاشة
  // الشكاوى/الضمان العامة (/support، /warranty-claims) — رابط مباشر لكل عنصر من هنا.
  const [linkedComplaints, setLinkedComplaints] = useState<ComplaintResponseDto[]>([]);
  const [linkedWarrantyClaims, setLinkedWarrantyClaims] = useState<OrderWarrantyClaimSummaryDto[]>([]);
  const [newInternalNote, setNewInternalNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  function load() {
    authedFetch<OrderDetailResponseDto>(`/admin/orders/${id}`)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلب'));
    // مسار منفصل عمداً — فشل تحميل الصور (نادر) ميمنعش عرض باقي تفاصيل الطلب
    authedFetch<OrderMediaResponseDto[]>(`/admin/orders/${id}/media`)
      .then(setMedia)
      .catch(() => setMedia([]));
    authedFetch<OrderRatingResponseDto[]>(`/admin/orders/${id}/ratings`)
      .then(setRatings)
      .catch(() => setRatings([]));
    authedFetch<OrderItemResponseDto[]>(`/admin/orders/${id}/quote-items`)
      .then(setQuoteItems)
      .catch(() => setQuoteItems([]));
    authedFetch<AdminOrderQuote[]>(`/admin/orders/${id}/quotes`)
      .then(setQuotes)
      .catch(() => setQuotes([]));
    // مسار تكوين سعر العميل (ADR-0107) — مسار منفصل، وفشله مايمنعش باقي الصفحة.
    authedFetch<OrderPriceTrail>(`/admin/orders/${id}/price-trail`)
      .then(setPriceTrail)
      .catch(() => setPriceTrail(null));
    // الملخص المالي (docs/08 §20 بند 11) — مسار منفصل عمداً زي الصور وبنود العرض فوق
    authedFetch<OrderFinancialSummaryResponseDto>(`/admin/orders/${id}/financial-summary`)
      .then(setFinancialSummary)
      .catch(() => setFinancialSummary(null));
    // توزيع أرباح الطاقم إداري فقط. فشل المسار لا يمنع عرض الملخص المالي أو باقي الطلب.
    loadEarningShares();
    // تعيين مساعد يدوي بعد التصعيد (ADR-0008) — محتاجين نعرف كام مساعد اتعيّن فعلاً عشان
    // نعرف نعرض فورم التعيين ولا لأ (لو الأماكن اكتملت بالفعل، مفيش داعي نعرضه).
    authedFetch<TeamMemberResponseDto[]>(`/admin/orders/${id}/team-members`)
      .then(setTeamMembers)
      .catch(() => setTeamMembers([]));
    // Timeline موحّد (Script 4 Part G §30-32) — مسار منفصل عمداً زي باقي المصادر الثانوية فوق.
    authedFetch<OrderTimelineEventResponseDto[]>(`/admin/orders/${id}/timeline`)
      .then(setTimeline)
      .catch(() => setTimeline([]));
    // فانل مطابقة الطلب (docs/08 §36.5/§35.8) — مسار منفصل عمداً زي باقي المصادر الثانوية فوق.
    // فشل هادئ متوقّع (400) لطلبات بلا service_zone_id.
    setFunnelError(null);
    authedFetch<OrderMatchingFunnelDto>(`/admin/orders/${id}/matching-funnel`)
      .then(setMatchingFunnel)
      .catch((err) => {
        setMatchingFunnel(null);
        setFunnelError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل فانل المطابقة');
      });
    // جولات المطابقة للطلب ده — مسار منفصل عمداً: لو وقع، الفانل بعدّاداته بيفضل ظاهر.
    authedFetch<OrderTraceResponseDto>(`/admin/operations/order-traces/${id}`)
      .then(({ trace }) => {
        setOrderTrace(trace);
        setTraceError(null);
      })
      .catch((err) => {
        setOrderTrace(null);
        // أشهر سبب: الدور مالوش `operations.view` (الصفحة بتفتح بـ`orders.view`) — والرسالة
        // دي هي الفرق بين «الأدمن يعرف يطلب الصلاحية» و«الأدمن فاكر إن الميزة اتشالت».
        setTraceError(err instanceof ApiError ? err.message : 'تعذّر التحميل');
      });
    // ملاحظات داخلية لمركز الاتصال (docs/08 §73 بند 3) — مسار منفصل عمداً زي باقي المصادر الثانوية فوق.
    authedFetch<OrderInternalNoteResponseDto[]>(`/admin/orders/${id}/notes`)
      .then(setInternalNotes)
      .catch(() => setInternalNotes([]));
    // شكاوى/ضمان مرتبطين بالطلب (docs/08 §73 بند 3 المؤجّل) — مسارين منفصلين عمداً زي باقي المصادر الثانوية فوق.
    authedFetch<ComplaintResponseDto[]>(`/admin/complaints?order_id=${id}`)
      .then(setLinkedComplaints)
      .catch(() => setLinkedComplaints([]));
    authedFetchPaginated<OrderWarrantyClaimSummaryDto>(`/admin/warranty-claims?order_id=${id}&per_page=50`)
      .then(({ items }) => setLinkedWarrantyClaims(items))
      .catch(() => setLinkedWarrantyClaims([]));
  }

  async function handleAddInternalNote(e: FormEvent) {
    e.preventDefault();
    if (!newInternalNote.trim()) return;
    setIsSavingNote(true);
    try {
      await authedFetch(`/admin/orders/${id}/notes`, { method: 'POST', body: JSON.stringify({ note: newInternalNote.trim() }) });
      setNewInternalNote('');
      authedFetch<OrderInternalNoteResponseDto[]>(`/admin/orders/${id}/notes`)
        .then(setInternalNotes)
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل حفظ الملاحظة');
    } finally {
      setIsSavingNote(false);
    }
  }

  useAdminLiveRefresh(['orders', 'payments', 'ratings'], (event) => {
    if (event.entity_id === null || event.entity_id === id || event.data?.orderId === id) load();
  });

  async function handleExplainTechnician(e: FormEvent) {
    e.preventDefault();
    if (!explainTechnicianId) return;
    setExplainLoading(true);
    setExplainError(null);
    setExplanation(null);
    try {
      const result = await authedFetch<TechnicianEligibilityExplanationDto>(
        `/admin/orders/${id}/technicians/${explainTechnicianId}/explain`,
      );
      setExplanation(result);
    } catch (err) {
      setExplainError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل التفسير');
    } finally {
      setExplainLoading(false);
    }
  }

  useEffect(() => {
    if (isLoading) return;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, id]);

  async function handleCancel(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) });
      setShowCancelForm(false);
      setCancelReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  function loadApprovedTechnicians() {
    authedFetchPaginated<AdminTechnicianResponseDto>('/admin/technicians?verification_status=approved&per_page=100')
      .then(({ items }) => setApprovedTechnicians(items))
      .catch(() => setApprovedTechnicians([]));
  }

  function loadEligibleAssistants() {
    authedFetch<EligibleAssistantDto[]>(`/admin/orders/${id}/eligible-assistants`)
      .then(setEligibleAssistants)
      .catch(() => setEligibleAssistants([]));
  }

  function loadEligibleReassignTechnicians() {
    authedFetch<{
      zoneId: string;
      items: { technicianId: string; fullName: string; technicianKind: TechnicianKindCode }[];
    }>(`/admin/orders/${id}/eligible-technicians`)
      .then(({ items }) => setEligibleReassignTechnicians(items))
      .catch(() => setEligibleReassignTechnicians([]));
  }

  function loadExplainCandidates() {
    authedFetch<{
      items: {
        technician_id: string;
        full_name: string;
        technician_kind: TechnicianKindCode;
        current_level: string | null;
        is_eligible_now: boolean;
        relation_to_order: ExplainCandidateRelationDto;
      }[];
      scope_note_ar: string;
    }>(`/admin/orders/${id}/explain-candidates`)
      .then(({ items, scope_note_ar }) => {
        setCandidatesError(null);
        setCandidatesScopeNote(scope_note_ar);
        setExplainCandidates(
          items.map((item) => ({
            technicianId: item.technician_id,
            fullName: item.full_name,
            technicianKind: item.technician_kind,
            currentLevel: item.current_level,
            isEligibleNow: item.is_eligible_now,
            relationToOrder: item.relation_to_order,
          })),
        );
      })
      // كان `.catch(() => setExplainCandidates([]))` — نداء فاشل كان بيدّي **نفس** شكل «مفيش
      // حد»، فالأدمن يفتكر إن مفيش مرشّحين وهو أصلاً مشافش الخطأ (بلاغ مالك 2026-09-19).
      .catch((err) => {
        setExplainCandidates([]);
        setCandidatesError(err instanceof ApiError ? err.message : 'مش قادرين نحمّل قايمة المرشّحين');
      });
  }

  async function handleReassign(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: technicianId }),
      });
      setShowReassignForm(false);
      setTechnicianId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  const refundablePaymentsWithBalance = refundablePaymentsOf(financialSummary).filter((row) => row.remainingCents > 0);
  // مشتق من البيانات، مش state موازي بيتزامن معاها: اختيار الأدمن بيفضل طول ما الدفعة لسه
  // صالحة، والطلب بدفعة واحدة مايستاهلش قرار أصلاً، وأي اختيار بطل صالح (الدفعة اترّدت بالكامل
  // بعد ما الصفحة اتحمّلت) بيسقط لوحده بدل ما يتبعت للسيرفر ويترفض.
  const effectiveRefundPaymentId = refundablePaymentsWithBalance.some((row) => row.payment.id === refundPaymentId)
    ? refundPaymentId
    : refundablePaymentsWithBalance.length === 1
      ? refundablePaymentsWithBalance[0].payment.id
      : '';
  const selectedRefundPayment =
    refundablePaymentsWithBalance.find((row) => row.payment.id === effectiveRefundPaymentId) ?? null;

  // كانت فجوة موثّقة صراحة: POST /admin/orders/:id/refund موجود ومختبر من زمان (payments/README.md)
  // بس مفيش زرار ليه في أي شاشة — نفس فئة فجوة "endpoint إداري من غير واجهة" اللي ظهرت في
  // /customers, /support, /payouts. مطابق تماماً لشروط payments.service.ts's refundOrder():
  // payment_status=paid + order_status في completed/disputed بس (canTransition(..., REFUNDED)).
  //
  // §24 تحديث: كان الزرار بيبعت استرجاع كامل بس (PromptDialog سبب بس) — الباك-إند بيدعم
  // amount_cents اختياري لاسترداد جزئي (ADR-0013 §9) من زمان بلا أي مدخل في الواجهة يوصله. فورم
  // زي adjust-price/cancel-with-fee: مبلغ فاضي = استرجاع كامل (السلوك الافتراضي زي ما هو).
  async function handleRefund(e: FormEvent) {
    e.preventDefault();
    if (refundReason.trim().length < 2) {
      window.alert('سبب الاسترجاع لازم يكون حرفين على الأقل');
      return;
    }
    const amountCents = refundAmountEgp.trim() === '' ? undefined : Math.round(Number(refundAmountEgp) * 100);
    if (amountCents !== undefined && (!Number.isFinite(amountCents) || amountCents < 1)) {
      window.alert('مبلغ الاسترجاع لازم يكون رقم أكبر من صفر');
      return;
    }
    // الباك-إند بيرفض الطلب المركّب من غير `payment_id` عشان مايخمّنش أي دفعة المقصودة. القرار
    // ده قرار أدمن حقيقي (دفعة أساسية ولا دفعة شغل إضافي)، فالواجهة بتاخده صراحة بدل ما العملية
    // تتقفل على رسالة خطأ بلا مخرج.
    if (refundablePaymentsWithBalance.length > 1 && !effectiveRefundPaymentId) {
      window.alert('الطلب فيه أكتر من دفعة قابلة للاسترداد — اختار الدفعة المقصودة الأول');
      return;
    }
    if (amountCents !== undefined && selectedRefundPayment && amountCents > selectedRefundPayment.remainingCents) {
      window.alert(`المبلغ أكبر من المتبقي في الدفعة المختارة (${formatEgp(selectedRefundPayment.remainingCents)})`);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          reason_notes: refundReason,
          ...(amountCents !== undefined ? { amount_cents: amountCents } : {}),
          ...(effectiveRefundPaymentId ? { payment_id: effectiveRefundPaymentId } : {}),
        }),
      });
      setShowRefundForm(false);
      setRefundPaymentId('');
      setRefundAmountEgp('');
      setRefundReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefundReconciliation(e: FormEvent) {
    e.preventDefault();
    if (!reconcilingRefundId || refundReconciliationEvidence.trim().length < 8) {
      window.alert('اكتب دليل المراجعة من لوحة مزود الدفع (8 حروف على الأقل)');
      return;
    }
    if (refundReconciliationOutcome === 'confirmed' && refundProviderReference.trim().length < 3) {
      window.alert('مرجع استرداد البوابة مطلوب عند التأكيد');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/refunds/${reconcilingRefundId}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: refundReconciliationOutcome,
          evidence: refundReconciliationEvidence,
          ...(refundReconciliationOutcome === 'confirmed' ? { provider_refund_id: refundProviderReference } : {}),
        }),
      });
      setReconcilingRefundId(null);
      setRefundProviderReference('');
      setRefundReconciliationEvidence('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // §24 — تأكيد إداري يدوي لتحويل إنستاباي (ADR-0013 §7) — الباك-إند idempotent بالفعل (قفل
  // pessimistic_write + فحص PENDING جوّه القفل)، فمفيش داعي confirm dialog إضافي هنا.
  async function handleConfirmInstaPay(paymentId: string) {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/payments/${paymentId}/confirm-instapay`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // كانت فجوة حقيقية — confirm-instapay فوق موجود من زمان، رفض دفعة InstaPay معلّقة لأ.
  async function handleRejectInstaPay(e: FormEvent) {
    e.preventDefault();
    if (!rejectInstaPayPaymentId || rejectInstaPayReason.trim().length < 2) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/payments/${rejectInstaPayPaymentId}/reject-instapay`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectInstaPayReason }),
      });
      setRejectInstaPayPaymentId(null);
      setRejectInstaPayReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // كانت فجوة موثّقة صراحة برضه: PATCH /admin/orders/:id/adjust-price موجود ومختبر (تعديل
  // يدوي لسعر طلب لسه ما اتدفعش، لتصحيح خطأ/تعويض) بس مفيش أي زرار ليه في أي شاشة.
  async function handleAdjustPrice(e: FormEvent) {
    e.preventDefault();
    const newTotalCents = Math.round(Number(newTotalEgp) * 100);
    if (!newTotalCents || newTotalCents < 0) return;
    if (adjustPriceReason.trim().length < 5) {
      window.alert('السبب لازم يكون 5 حروف على الأقل');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/adjust-price`, {
        method: 'PATCH',
        body: JSON.stringify({ new_total_amount_cents: newTotalCents, reason: adjustPriceReason }),
      });
      setShowAdjustPriceForm(false);
      setNewTotalEgp('');
      setAdjustPriceReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePhotoQuote(e: FormEvent) {
    e.preventDefault();
    const quotedAmountCents = Math.round(Number(photoQuoteEgp) * 100);
    if (!Number.isFinite(quotedAmountCents) || quotedAmountCents < 1) {
      setError('اكتب سعر صحيح أكبر من صفر');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/photo-quote`, {
        method: 'POST',
        body: JSON.stringify({
          quoted_amount_cents: quotedAmountCents,
          ...(photoQuoteNote.trim() ? { note: photoQuoteNote.trim() } : {}),
        }),
      });
      setPhotoQuoteEgp('');
      setPhotoQuoteNote('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إرسال عرض السعر');
    } finally {
      setIsSaving(false);
    }
  }

  // بند 8 — «تحويل لمعاينة في الموقع». الطلب بيتوزّع على معاين والسعر بيتحدد بعد الزيارة.
  async function handleRouteToOnsite(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setTriageOutcome(null);
    try {
      await authedFetch(`/admin/orders/${id}/route-to-onsite-assessment`, {
        method: 'POST',
        body: JSON.stringify({ reason: triageReason.trim() }),
      });
      setTriageReason('');
      setTriageOutcome('اتحوّل لمعاينة في الموقع، والطلب راح للتوزيع على معاين.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر التحويل لمعاينة في الموقع');
    } finally {
      setIsSaving(false);
    }
  }

  // بند 8 — «طلب معلومات إضافية». مفيش تغيير حالة: العميل بياخد إشعار بالمطلوب منه.
  async function handleRequestInfo(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setTriageOutcome(null);
    try {
      await authedFetch(`/admin/orders/${id}/request-assessment-info`, {
        method: 'POST',
        body: JSON.stringify({ message: infoRequest.trim() }),
      });
      setInfoRequest('');
      setTriageOutcome('اتبعت للعميل طلب المعلومات، والطلب فاضل مستني التسعير.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إرسال طلب المعلومات');
    } finally {
      setIsSaving(false);
    }
  }

  // بند 8 — قبول/رفض عرض خرج عن النطاق. العرض ده العميل ماشافهوش أصلاً.
  async function handleAboveRangeDecision(quoteId: string, approve: boolean) {
    if (quoteDecisionReason.trim().length < 3) {
      setError('اكتب سبب القرار — بيتسجّل في سجل النشاط');
      return;
    }
    setIsSaving(true);
    setError(null);
    setTriageOutcome(null);
    try {
      await authedFetch(`/admin/orders/${id}/quotes/${quoteId}/above-range-decision`, {
        method: 'POST',
        body: JSON.stringify({ approve, reason: quoteDecisionReason.trim() }),
      });
      setQuoteDecisionReason('');
      setTriageOutcome(approve ? 'العرض اتعمد وراح للعميل.' : 'العرض اترفض، والفني مطلوب منه سعر جديد.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تسجيل القرار');
    } finally {
      setIsSaving(false);
    }
  }

  // بند 8 — إعادة إصدار عرض منتهي الصلاحية كإصدار **جديد**.
  async function handleReissueQuote(e: FormEvent) {
    e.preventDefault();
    const trimmed = reissueEgp.trim();
    const newAmountCents = trimmed ? Math.round(Number(trimmed) * 100) : undefined;
    if (trimmed && (!Number.isFinite(newAmountCents) || (newAmountCents ?? 0) < 1)) {
      setError('اكتب سعر صحيح أكبر من صفر، أو سيبه فاضي عشان يتبعت بنفس السعر');
      return;
    }
    setIsSaving(true);
    setError(null);
    setTriageOutcome(null);
    try {
      await authedFetch(`/admin/orders/${id}/quotes/reissue`, {
        method: 'POST',
        body: JSON.stringify(newAmountCents ? { new_amount_cents: newAmountCents } : {}),
      });
      setReissueEgp('');
      setTriageOutcome('اتعمل إصدار جديد من العرض وراح للعميل بمهلة جديدة.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّرت إعادة إصدار العرض');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdminProblemImages(files: FileList | null) {
    if (!files?.length) return;
    setUploadingProblemImages(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const body = new FormData();
        body.set('file', file);
        const uploaded = await authedFetch<OrderMediaResponseDto>(`/admin/orders/${id}/problem-images`, {
          method: 'POST',
          body,
        });
        setMedia((current) => [...current, uploaded]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر رفع صور المشكلة');
    } finally {
      setUploadingProblemImages(false);
    }
  }

  // زيارة فاشلة/عدم حضور (docs/08 §22 بند 4-5) — الطلب disputed بعد بلاغ الفني (report-failed-visit)،
  // الأدمن بيحل بعد المراجعة: reschedule (موعد جديد فعلي، راجع docs/08 §25.2) أو cancel_with_fee
  // (رسوم + استرداد الباقي لو مدفوع مسبقًا). نفس مستوى حساسية refund/adjust-price (step-up MFA).
  //
  // لا نسمح بعودة الطلب إلى ACCEPTED بنفس الموعد القديم، لكن لا نطلب من الفني أن ينشئ
  // slot يدويًا: هذا نفس endpoint ومحرك الإتاحة الذي تستخدمه إعادة الجدولة العامة.
  async function handleOpenRescheduleForm() {
    setShowRescheduleForm((s) => !s);
    if (failedVisitRescheduleOptions !== null || !order?.technician_id) return;
    try {
      const options = await authedFetch<RescheduleOptionDto[]>(`/admin/orders/${id}/reschedule-options`);
      setFailedVisitRescheduleOptions(options);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل أيام الفني المتاحة');
    }
  }

  async function handleResolveFailedVisitReschedule(e: FormEvent) {
    e.preventDefault();
    if (!failedVisitRescheduleDate) {
      window.alert('لازم تختار يوم جديد');
      return;
    }
    if (rescheduleNotes.trim().length < 5) {
      window.alert('ملاحظات المراجعة لازم تكون 5 حروف على الأقل');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/resolve-failed-visit`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: 'reschedule',
          admin_notes: rescheduleNotes,
          new_scheduled_at: new Date(`${failedVisitRescheduleDate}T00:00:00Z`).toISOString(),
        }),
      });
      setShowRescheduleForm(false);
      setFailedVisitRescheduleOptions(null);
      setFailedVisitRescheduleDate('');
      setRescheduleNotes('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResolveFailedVisitCancelWithFee(e: FormEvent) {
    e.preventDefault();
    if (failedVisitNotes.trim().length < 5) {
      window.alert('ملاحظات الأدمن لازم تكون 5 حروف على الأقل');
      return;
    }
    const feeCents = visitFeeEgp.trim() === '' ? undefined : Math.round(Number(visitFeeEgp) * 100);
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/resolve-failed-visit`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: 'cancel_with_fee',
          ...(feeCents !== undefined ? { visit_fee_cents: feeCents } : {}),
          admin_notes: failedVisitNotes,
        }),
      });
      setShowCancelWithFeeForm(false);
      setVisitFeeEgp('');
      setFailedVisitNotes('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — الطلب disputed بعد بلاغ الفني (cash-not-received)،
  // بيتميّز عن نزاع الزيارة الفاشلة فوق بـtechnician_cash_not_received_at != null. retry يرجّع الطلب
  // work_completed (يقدر يتحصّل تاني عادي)، confirm_received تسوية إدارية مباشرة (بيقفل الطلب completed).
  async function handleResolveCashDisputeRetry() {
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/resolve-cash-dispute`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'retry', admin_notes: 'الأدمن قرر إعادة محاولة التحصيل بعد المراجعة' }),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResolveCashDisputeConfirmReceived(e: FormEvent) {
    e.preventDefault();
    if (cashDisputeNotes.trim().length < 5) {
      window.alert('ملاحظات الأدمن لازم تكون 5 حروف على الأقل');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/resolve-cash-dispute`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'confirm_received', admin_notes: cashDisputeNotes }),
      });
      setShowCashDisputeConfirmForm(false);
      setCashDisputeNotes('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // تعيين مساعد يدوي بعد تصعيد مطابقة المساعد التلقائية (ADR-0008) — POST /admin/orders/:id/assistants
  // كان موجود بلا أي واجهة تستخدمه، نفس فئة adjust-price/refund فوق.
  async function handleAssignAssistant(e: FormEvent) {
    e.preventDefault();
    if (!assistantTechnicianId) return;
    setIsSaving(true);
    setError(null);
    setCrewAssignOutcome(null);
    try {
      const outcome = await authedFetch<CrewAssignResponseDto>(`/admin/orders/${id}/assistants`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: assistantTechnicianId }),
      });
      // docs/08 §108-A — نفس رسالة apps/technician-app's RecruitTeamScreen بالحرف: الأدمن لازم
      // يعرف هل الإضافة فورية ولا اتحوّلت لعرض مستني قبول الفني، مش يفترض النجاح الصامت.
      setCrewAssignOutcome(
        outcome.status === 'offer_sent'
          ? {
              isOffer: true,
              message: `عنده شغل النهاردة — اتبعتله فرصة اختيارية بدل إضافة فورية، مستني رده (${CAPACITY_TIER_LABELS[outcome.capacity_tier ?? 'MEANINGFUL']})`,
            }
          : { isOffer: false, message: 'اتضاف المساعد فورًا لطاقم الطلب' },
      );
      setShowAssignAssistantForm(false);
      setAssistantTechnicianId('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // إدارة طاقم الطلب من الأدمن (Script 4 §22-29, §38-41) — كانت فجوة موثّقة صراحة: مفيش مسار
  // أدمن لإدارة أعضاء الطاقم العاديين (بعكس المساعدين فوق اللي عندهم مسار من زمان).
  async function handleAddCrewMember(e: FormEvent) {
    e.preventDefault();
    if (!crewTechnicianId || !crewRoleLabel) return;
    setIsSaving(true);
    setError(null);
    setCrewAssignOutcome(null);
    try {
      const outcome = await authedFetch<CrewAssignResponseDto>(`/admin/orders/${id}/team-members`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: crewTechnicianId, role_label: crewRoleLabel, member_type: crewMemberType }),
      });
      setCrewAssignOutcome(
        outcome.status === 'offer_sent'
          ? {
              isOffer: true,
              message: `عنده شغل النهاردة — اتبعتله فرصة اختيارية بدل إضافة فورية، مستني رده (${CAPACITY_TIER_LABELS[outcome.capacity_tier ?? 'MEANINGFUL']})`,
            }
          : { isOffer: false, message: 'اتضاف الفني فورًا لطاقم الطلب' },
      );
      setShowAddCrewForm(false);
      setCrewTechnicianId('');
      setCrewRoleLabel('');
      setCrewMemberType('team_member');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveCrewMember(e: FormEvent, memberId: string) {
    e.preventDefault();
    if (!removeCrewReason) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await authedFetch<RemoveCrewMemberResponseDto>(`/admin/orders/${id}/team-members/${memberId}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason: removeCrewReason }),
      });
      setCrewShortageWarning(result.crewShortage);
      setRemovingCrewMemberId(null);
      setRemoveCrewReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReplaceCrewMember(e: FormEvent, memberId: string) {
    e.preventDefault();
    if (!replaceCrewTechnicianId || !replaceCrewReason) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/team-members/${memberId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          new_technician_id: replaceCrewTechnicianId,
          reason: replaceCrewReason,
          ...(replaceCrewRoleLabel ? { role_label: replaceCrewRoleLabel } : {}),
        }),
      });
      setReplacingCrewMemberId(null);
      setReplaceCrewTechnicianId('');
      setReplaceCrewReason('');
      setReplaceCrewRoleLabel('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  // عضو طاقم عادي (اعتماد/فريق) بعكس المساعد (member_type='assistant', مساره منفصل فوق).
  // docs/08 §70 — الفرز بالنوع الحقيقي (`member_type`) مش بالنص الحر في `role_label`: كارت
  // "المساعدين" كان بيعرض **كل** الأعضاء، فأي حد الأدمن يضيفه كان بيبان مساعد مهما كان دوره.
  // وكارت "طاقم الطلب" (اللي فيه الإزالة/الاستبدال) بيعرض الكل دلوقتي — مساعد مضاف إداريًا كان
  // مالوش أي مكان يتشال أو يتستبدل منه.
  const assistantMembers = teamMembers.filter((m) => m.member_type === 'assistant');
  const crewMembers = teamMembers;

  // ADR-0083 §5 — السبب بيتحسب مرة واحدة: الزرار وحالة التعطيل ونص الشرح كلهم بيقروا منه، فمفيش
  // احتمال إن الزرار يبان مفتوح والفورم يقول مقفول.
  const adminRescheduleBlockedReason = order
    ? orderRescheduleBlockedReason(order.order_status, Boolean(order.technician_id))
    : null;

  // إعادة جدولة عامة من الأدمن (Script 4 Part K §42، ADR-0034) — الأيام المتاحة بتتحسب في
  // الباك-إند بنفس محرك التوافر الموحّد اللي المطابقة بتستخدمه (technicianAvailabilityCondition)،
  // مش من صفوف سلوت. اليوم غير المتاح بيتعرض معطّل بسببه، مش بيختفي بلا تفسير.
  async function handleOpenAdminRescheduleForm() {
    setShowAdminRescheduleForm((s) => !s);
    if (adminRescheduleOptions !== null || !order?.technician_id) return;
    try {
      const options = await authedFetch<RescheduleOptionDto[]>(`/admin/orders/${id}/reschedule-options`);
      setAdminRescheduleOptions(options);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل مواعيد الفني المتاحة');
    }
  }

  async function handleAdminReschedule(e: FormEvent) {
    e.preventDefault();
    if (!adminRescheduleDate || adminRescheduleReason.trim().length < 5) return;
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          new_scheduled_at: new Date(`${adminRescheduleDate}T00:00:00Z`).toISOString(),
          reason: adminRescheduleReason,
        }),
      });
      setShowAdminRescheduleForm(false);
      setAdminRescheduleOptions(null);
      setAdminRescheduleDate('');
      setAdminRescheduleReason('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !order) {
    return (
      <AppShell>
        <p className="text-destructive">{error}</p>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <p className="text-muted-foreground">جاري التحميل…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={
          <>
            طلب {order.order_number}
            <StatusChip tone={orderStatusTone(order.order_status)}>
              {ORDER_STATUS_LABELS[order.order_status]}
            </StatusChip>
            {order.order_type === 'emergency' && <Badge variant="destructive">طوارئ</Badge>}
            {order.recurring_template_id ? (
              // طلب متولّد من خطة متكررة — لينك مباشر للخطة نفسها (تعريف التكرار) في صفحة الخطط
              <Link href="/recurring-orders">
                <Badge variant="outline">متولّد من حجز متكرر</Badge>
              </Link>
            ) : (
              <>{order.order_type === 'recurring' && <Badge variant="outline">متكرر</Badge>}</>
            )}
            {order.original_order_id && (
              <Link href={`/orders/${order.original_order_id}`}>
                <Badge variant="outline">إعادة زيارة — الطلب الأصلي</Badge>
              </Link>
            )}
            {order.building_id && <Badge variant="outline">عمارة</Badge>}
          </>
        }
        actions={
          <Button variant="outline" onClick={goBack}>
            رجوع للقايمة
          </Button>
        }
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {order.order_status === 'awaiting_admin_quote' && (
        <Card className="mb-6 border-amber-300 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="text-base">العميل مستني تسعير الصور</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            <div>
              <p className="mb-3 text-sm text-muted-foreground">
                راجع صور المشكلة وحدد السعر الكامل. الطلب لن يدخل المطابقة إلا بعد موافقة العميل.
              </p>
              {hasPermission('orders.adjust_price') && (
                <label className="mb-3 inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50">
                  {uploadingProblemImages ? 'جاري رفع الصور…' : 'إضافة صور وصلت للإدارة'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    disabled={uploadingProblemImages}
                    onChange={(event) => {
                      void handleAdminProblemImages(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
              )}
              {media.filter((item) => item.media_type === 'problem_photo').length === 0 ? (
                <p className="text-sm text-destructive">لا توجد صور مشكلة صالحة على الطلب.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {media
                    .filter((item) => item.media_type === 'problem_photo')
                    .map((item) => (
                      <a key={item.id} href={resolveMediaUrl(item.file_url)} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- صورة من تخزين الباك إند */}
                        <img
                          src={resolveMediaUrl(item.file_url)}
                          alt="صورة المشكلة"
                          className="aspect-square w-full rounded-xl border object-cover"
                        />
                      </a>
                    ))}
                </div>
              )}
            </div>
            <form onSubmit={handlePhotoQuote} className="flex flex-col gap-3 rounded-xl border bg-background p-4">
              <div className="space-y-1.5">
                <Label htmlFor="photo-quote-egp">السعر الكامل (ج.م.)</Label>
                <Input
                  id="photo-quote-egp"
                  inputMode="decimal"
                  value={photoQuoteEgp}
                  onChange={(event) => setPhotoQuoteEgp(event.target.value)}
                  placeholder="مثال: 850"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="photo-quote-note">ملاحظة للعميل (اختياري)</Label>
                <Input
                  id="photo-quote-note"
                  value={photoQuoteNote}
                  onChange={(event) => setPhotoQuoteNote(event.target.value)}
                  placeholder="ما الذي يشمله السعر؟"
                />
              </div>
              <Button
                type="submit"
                disabled={
                  isSaving ||
                  !hasPermission('orders.adjust_price') ||
                  media.every((item) => item.media_type !== 'problem_photo')
                }
              >
                {isSaving ? 'جاري الإرسال…' : 'إرسال السعر للعميل'}
              </Button>
              {!hasPermission('orders.adjust_price') && (
                <p className="text-xs text-destructive">تحتاج صلاحية تعديل الأسعار لإرسال العرض.</p>
              )}
            </form>

            {/* بند 8 — القرارين التانيين على نفس الشاشة: مش كل فرز بينتهي بسعر. من غيرهم الأدمن
                مالوش غير «ابعت سعر» حتى لو الصور مش كفاية أصلاً. */}
            <div className="grid gap-3 md:grid-cols-2">
              <form onSubmit={handleRouteToOnsite} className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                <Label htmlFor="triage-reason">الصور مش كفاية — تحويل لمعاينة في الموقع</Label>
                <Input
                  id="triage-reason"
                  value={triageReason}
                  onChange={(event) => setTriageReason(event.target.value)}
                  placeholder="السبب اللي هيتسجّل ويظهر في تاريخ الطلب"
                  required
                  minLength={3}
                />
                <p className="text-xs text-muted-foreground">
                  الطلب هيتوزّع على معاين، وهيتحمّل رسم المعاينة المحدد في الخدمة، والسعر هيتحدد بعد الزيارة.
                </p>
                <Button type="submit" variant="outline" disabled={isSaving || !hasPermission('orders.adjust_price')}>
                  {isSaving ? 'جاري التحويل…' : 'تحويل لمعاينة في الموقع'}
                </Button>
              </form>

              <form onSubmit={handleRequestInfo} className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                <Label htmlFor="info-request">ناقص معلومات — اطلبها من العميل</Label>
                <Input
                  id="info-request"
                  value={infoRequest}
                  onChange={(event) => setInfoRequest(event.target.value)}
                  placeholder="مثال: ابعتلنا صورة للعداد من قريب"
                  required
                  minLength={3}
                />
                <p className="text-xs text-muted-foreground">
                  العميل هياخد إشعار بالمطلوب منه. حالة الطلب مش هتتغير — هيفضل مستني التسعير.
                </p>
                <Button type="submit" variant="outline" disabled={isSaving || !hasPermission('orders.adjust_price')}>
                  {isSaving ? 'جاري الإرسال…' : 'طلب معلومات إضافية'}
                </Button>
              </form>
            </div>
            {triageOutcome && <p className="text-sm text-emerald-600">{triageOutcome}</p>}
          </CardContent>
        </Card>
      )}

      {/* بند 8 — إصدارات عرض السعر وقراراتها. الـendpoint كان موجود من غير مستهلك، يعني الأدمن
          ماكانش يقدر يشوف تاريخ الأسعار ولا يتصرف في عرض خارج النطاق أو منتهي. */}
      {quotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>عروض السعر ({quotes.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">الإصدار</th>
                    <th className="p-2 text-start">المصدر</th>
                    <th className="p-2 text-start">المبلغ</th>
                    <th className="p-2 text-start">الحالة</th>
                    <th className="p-2 text-start">الصلاحية</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-t">
                      <td className="p-2">#{quote.version}</td>
                      <td className="p-2">{QUOTE_SOURCE_LABELS[quote.source] ?? quote.source}</td>
                      <td className="p-2 whitespace-nowrap">{formatEgp(quote.amount_cents)}</td>
                      <td className="p-2">
                        <Badge variant={quote.status === 'pending_admin_review' ? 'destructive' : 'outline'}>
                          {QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
                        </Badge>
                      </td>
                      <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(quote.valid_until).toLocaleString('ar-EG')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {quotes
              .filter((quote) => quote.status === 'pending_admin_review')
              .map((quote) => (
                <div key={quote.id} className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                  <p className="text-sm font-medium">
                    الإصدار #{quote.version} بـ{formatEgp(quote.amount_cents)} عدّى النطاق
                    {quote.expected_max_cents ? ` (سقف النطاق ${formatEgp(quote.expected_max_cents)})` : ''} — العميل لسه ماشافهوش.
                  </p>
                  {quote.diagnosis && <p className="text-xs text-muted-foreground">تشخيص الفني: {quote.diagnosis}</p>}
                  <Input
                    value={quoteDecisionReason}
                    onChange={(event) => setQuoteDecisionReason(event.target.value)}
                    placeholder="سبب القرار (بيتسجّل في سجل النشاط)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={isSaving || !hasPermission('orders.adjust_price')}
                      onClick={() => handleAboveRangeDecision(quote.id, true)}
                    >
                      اعتماد وإرساله للعميل
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isSaving || !hasPermission('orders.adjust_price')}
                      onClick={() => handleAboveRangeDecision(quote.id, false)}
                    >
                      رفض وطلب سعر جديد
                    </Button>
                  </div>
                </div>
              ))}

            {quotes.length > 0 && ['expired'].includes(quotes[quotes.length - 1].status) && (
              <form onSubmit={handleReissueQuote} className="space-y-2 rounded-xl border bg-background p-4">
                <Label htmlFor="reissue-egp">العرض خلصت صلاحيته — إعادة إصدار</Label>
                <Input
                  id="reissue-egp"
                  inputMode="decimal"
                  value={reissueEgp}
                  onChange={(event) => setReissueEgp(event.target.value)}
                  placeholder="سيبه فاضي عشان يتبعت بنفس السعر"
                />
                <p className="text-xs text-muted-foreground">
                  بيتعمل <strong>إصدار جديد</strong> بمهلة جديدة — العرض القديم بيفضل منتهي في التاريخ.
                </p>
                <Button type="submit" variant="outline" disabled={isSaving || !hasPermission('orders.adjust_price')}>
                  {isSaving ? 'جاري الإصدار…' : 'إعادة إصدار العرض'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}


      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات الطلب</CardTitle>
          </CardHeader>
          {/* العناوين في عمود والقيم في عمود (`DataList`) بدل صفوف `<p>عنوان: قيمة</p>` —
              اللقطة الحقيقية كانت تمن سطور نص جارية مفيهاش أي عمود تمسكه العين. النصوص
              الطويلة نزلت لـ`DataBlock` تحت عشان ما تضغطش عمود القيم. */}
          <CardContent>
            <DataList>
              {/* اسم الخدمة — كان غايب تمامًا (docs/08 §73 بند 3)، موظف مركز الاتصال محتاج يعرف
                  الطلب ده على إيه بالظبط من أول نظرة، مش يستنتج من السعر/الوصف بس. */}
              {order.service_name_ar && (
                <DataRow label="الخدمة" tone="strong">
                  {order.service_name_ar}
                </DataRow>
              )}
              <DataRow label="نوع الطلب">{ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</DataRow>
              <DataRow label="وضع الحجز">{BOOKING_MODE_LABELS[order.booking_mode] ?? order.booking_mode}</DataRow>
              {/* موعد الخدمة المطلوب — مختلف تمامًا عن "اتحجز في" (وقت إنشاء الطلب). طلب مالك صريح:
                  موظفي العمليات كانوا بيلخبطوا بين الاتنين. null = "في أقرب وقت ممكن" (ASAP)، مش
                  غياب بيانات — نفس دلالة scheduled_at=null في باقي المشروع (ScheduleChoice.asap). */}
              <DataRow label="موعد الخدمة المطلوب" tone="strong">
                {order.scheduled_at ? (
                  (formatDateTimeAr(order.scheduled_at) ?? '—')
                ) : (
                  <Badge variant="secondary">في أقرب وقت ممكن</Badge>
                )}
              </DataRow>
              <DataRow label="اتحجز في">{order.placed_at ? (formatDateTimeAr(order.placed_at) ?? '—') : '—'}</DataRow>
              {/* اسم/تليفون الفني بدل الـUUID الخام (طلب مالك صريح — موظف العمليات مش المفروض ينسخ
                  UUID يدويًا عشان يعرف مين الفني). الـUUID لسه موجود كمعلومة ثانوية (title) لو
                  احتاجه حد للتصحيح التقني. الاسم قابل للنقر — بيودّي لصفحة بروفايل الفني. */}
              <DataRow label="الفني">
                {order.technician_id ? (
                  order.technician_name ? (
                    <Link href={`/technicians/${order.technician_id}`} className="underline" title={order.technician_id}>
                      {order.technician_name}
                      {order.technician_phone ? ` — ${order.technician_phone}` : ''}
                    </Link>
                  ) : (
                    <span dir="ltr" title="اسم الفني مش متاح">
                      {order.technician_id}
                    </span>
                  )
                ) : (
                  <span className="text-muted-foreground">لسه مفيش</span>
                )}
              </DataRow>
              <DataRow label="الإجمالي" tone="strong">
                {formatEgp(order.total_amount_cents)}
              </DataRow>
              <DataRow label="حالة الدفع">
                <StatusChip tone={paymentStatusTone(order.payment_status)}>
                  {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                </StatusChip>
              </DataRow>
              <DataRow label="رسوم الكشف">{formatEgp(order.inspection_fee_cents)}</DataRow>
              {/*
                الصفوف التلاتة دي بتتعرض **دايمًا، حتى بصفر** (بلاغ مالك 2026-09-19).

                في جولة التنظيم (§158) خفّيتهم عند الصفر بحجّة «سطر مالوش معلومة». الحجّة دي
                غلط في ملخّص مالي: «رسوم الطوارئ: ٠» جواب على سؤال («الطلب ده اتحسبتله رسوم
                طوارئ؟»)، أما غياب السطر فمش جواب — ممكن يتقرا «مفيش» وممكن يتقرا «الخانة
                اتشالت». وده بالظبط اللي حصل مع المالك.
              */}
              <DataRow label="رسوم الطوارئ" tone={order.surge_amount_cents > 0 ? 'danger' : undefined}>
                {formatEgp(order.surge_amount_cents)}
              </DataRow>
              <DataRow label="الخصم">{formatEgp(order.discount_amount_cents)}</DataRow>
              <DataRow label="تأجيلات العميل الذاتية">
                <Badge variant="secondary">{order.customer_reschedule_count ?? 0}</Badge>
              </DataRow>
              {order.warranty_expires_at && (
                <DataRow label="الضمان لحد">
                  {formatDateTimeAr(order.warranty_expires_at) ?? '—'}
                  {new Date(order.warranty_expires_at) > new Date() ? (
                    <Badge variant="secondary" className="ms-2">
                      سارٍ
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ms-2">
                      منتهي
                    </Badge>
                  )}
                </DataRow>
              )}
              {order.problem_description && <DataBlock label="وصف المشكلة">{order.problem_description}</DataBlock>}
              {/* docs/08 §71 — اللي العميل اختاره في الفورم الديناميكي وقت الحجز. */}
              {order.customer_inputs && order.customer_inputs.length > 0 && (
                <DataBlock label="اختيارات العميل وقت الحجز">
                  {order.customer_inputs
                    .map((input) => `${input.label}: ${input.value}${input.unit ? ` ${input.unit}` : ''}`)
                    .join(' · ')}
                </DataBlock>
              )}
              {order.customer_notes && <DataBlock label="ملاحظات العميل">{order.customer_notes}</DataBlock>}
              {order.optional_warranty && (
                <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <p className="font-medium">ضمان إضافي: {order.optional_warranty.name_ar}</p>
                  <p className="mt-0.5 text-xs">
                    {order.optional_warranty.coverage_months} شهر · تكلفته {formatEgp(order.warranty_price_cents)} ضمن إجمالي الطلب
                  </p>
                </div>
              )}
            </DataList>
          </CardContent>
          {/* ADR-0083 §5 — الزرار بيفضل **ظاهر دايمًا**. طلب المالك الحرفي: «إلغاء الطلب دايمًا
              ظاهرة للأدمن، يكون دايمًا عنده أكسس». إخفاؤه كان بيخلي الأدمن يفتكر إن الميزة مش
              موجودة؛ دلوقتي في الحالة الممنوعة بيبقى معطّل ومعاه السبب والمسار البديل. */}
          <CardFooter className="flex-col items-stretch gap-3">
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={isSaving || !isOrderCancellable(order.order_status)}
                  title={orderCancelBlockedReason(order.order_status) ?? undefined}
                  onClick={() => setShowCancelForm((s) => !s)}
                >
                  إلغاء الطلب
                </Button>
                {isOrderReassignable(order.order_status) && hasPermission('orders.reassign') && (
                  <Button
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      setShowReassignForm((s) => !s);
                      if (!eligibleReassignTechnicians) loadEligibleReassignTechnicians();
                    }}
                  >
                    {order.technician_id ? 'استبدال منفّذ الطلب' : 'تعيين منفّذ للطلب'}
                  </Button>
                )}
              </div>
              {orderCancelBlockedReason(order.order_status) && (
                <p className="rounded-md border border-border bg-muted/40 p-2 text-sm text-muted-foreground">
                  <span className="font-medium">الإلغاء الإداري مقفول دلوقتي:</span>{' '}
                  {orderCancelBlockedReason(order.order_status)}
                </p>
              )}
              {showCancelForm && isOrderCancellable(order.order_status) && (
                <form onSubmit={handleCancel} className="flex flex-col gap-2">
                  {['awaiting_initial_quote_approval', 'awaiting_quote_approval', 'in_progress'].includes(order.order_status) && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                      {order.order_status === 'in_progress'
                        ? 'التنفيذ بدأ بالفعل. الإلغاء قرار إداري موثق يزيل الطلب من قوائم التنفيذ فقط، ولا ينفذ أي استرداد تلقائي؛ راجع المدفوعات ونفّذ الاسترداد اليدوي عند الحاجة.'
                        : 'العميل لم يرد على عرض السعر. الإلغاء يزيل الطلب من قوائم التنفيذ، ولا ينفذ أي استرداد تلقائي؛ راجع المدفوعات ونفّذ الاسترداد اليدوي عند الحاجة.'}
                    </p>
                  )}
                  <Label htmlFor="cancel_reason">سبب الإلغاء</Label>
                  <Input
                    id="cancel_reason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    minLength={5}
                    required
                  />
                  <Button type="submit" variant="destructive" size="sm" disabled={isSaving}>
                    تأكيد الإلغاء
                  </Button>
                </form>
              )}
              {showReassignForm && (
                <form onSubmit={handleReassign} className="flex flex-col gap-2">
                  <Label htmlFor="technician_id">المنفّذ الجديد</Label>
                  {!eligibleReassignTechnicians ? (
                    <p className="text-sm text-muted-foreground">جاري تحميل المؤهلين لهذا الطلب…</p>
                  ) : eligibleReassignTechnicians.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      مفيش فنيين ولا مساعدين مؤهلين ومتاحين لخدمة/منطقة/موعد الطلب ده دلوقتي — استخدم مفتّش المطابقة فوق
                      عشان تعرف سبب استبعاد كل واحد.
                    </p>
                  ) : (
                    <SelectNative
                      id="technician_id"
                      value={technicianId}
                      onChange={(e) => setTechnicianId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        اختار فني أو مساعد مؤهّل
                      </option>
                      {/* docs/08 §107 — القايمة دي بتفضل مقصورة على المؤهّلين فعلاً (مش تمييز
                          ضد المساعد: نفس assertCoreEligibility() هيرفض أي حد غير مؤهّل بـ409
                          وقت التنفيذ). الرمز جنب الاسم بيوضّح إن المساعد موجود فيها فعلاً. */}
                      {(['technician', 'assistant'] as TechnicianKindCode[]).map((kind) => {
                        const group = eligibleReassignTechnicians.filter((t) => t.technicianKind === kind);
                        if (group.length === 0) return null;
                        return (
                          <optgroup key={kind} label={kind === 'technician' ? 'فنيين' : 'مساعدين'}>
                            {group.map((tech) => (
                              <option key={tech.technicianId} value={tech.technicianId}>
                                {technicianKindOptionPrefix(tech.technicianKind)} {tech.fullName}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </SelectNative>
                  )}
                  <p className="text-xs text-muted-foreground">
                    الطلب المقبول يظل مقبولًا بعد الاستبدال؛ لا يتغير السعر أو الدفع أو الموعد.
                  </p>
                  <Button type="submit" size="sm" disabled={isSaving || !technicianId}>
                    تأكيد إعادة التعيين
                  </Button>
                </form>
              )}
            </CardFooter>
          {/* إعادة جدولة عامة من الأدمن (Script 4 Part K §42، ADR-0083 §3/§5). استخدام تشغيلي:
              العميل يتصل يطلب تأجيل الميعاد، الموظف بينفذها نيابة عنه — أو الفني وصل ولقى
              المكان مقفول. الزرار **ظاهر دايمًا** بطلب المالك، ومعطّل بسبب مكتوب لما يتقفل. */}
          {hasPermission('orders.reschedule') && (
            <CardFooter className="flex-col items-stretch gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || adminRescheduleBlockedReason !== null}
                title={adminRescheduleBlockedReason ?? undefined}
                onClick={handleOpenAdminRescheduleForm}
              >
                إعادة جدولة الموعد
              </Button>
              {adminRescheduleBlockedReason && (
                <p className="rounded-md border border-border bg-muted/40 p-2 text-sm text-muted-foreground">
                  <span className="font-medium">إعادة الجدولة مقفولة دلوقتي:</span> {adminRescheduleBlockedReason}
                </p>
              )}
              {showAdminRescheduleForm && adminRescheduleBlockedReason === null && (
                <form onSubmit={handleAdminReschedule} className="flex flex-col gap-2">
                  <Label htmlFor="admin_reschedule_date">اليوم الجديد</Label>
                  {!order.technician_id && (
                    <Input
                      id="admin_reschedule_date"
                      type="date"
                      value={adminRescheduleDate}
                      min={minRescheduleDate}
                      onChange={(e) => setAdminRescheduleDate(e.target.value)}
                      required
                    />
                  )}
                  {order.technician_id && adminRescheduleOptions === null && (
                    <p className="text-xs text-muted-foreground">جاري تحميل أيام الفني المتاحة…</p>
                  )}
                  {order.technician_id && adminRescheduleOptions !== null && (
                    <>
                      <SelectNative
                        id="admin_reschedule_date"
                        value={adminRescheduleDate}
                        onChange={(e) => setAdminRescheduleDate(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          اختار يوم
                        </option>
                        {adminRescheduleOptions.map((option) => (
                          <option key={option.date} value={option.date} disabled={!option.available}>
                            {option.date}
                            {option.available ? '' : ' — الفني مشغول/مش متاح'}
                          </option>
                        ))}
                      </SelectNative>
                      {adminRescheduleOptions.every((option) => !option.available) && (
                        <p className="text-xs text-muted-foreground">
                          الفني ده مشغول في كل الأيام الجاية — جرّب استبدال الفني بدل إعادة الجدولة
                        </p>
                      )}
                    </>
                  )}
                  <Label htmlFor="admin_reschedule_reason">سبب إعادة الجدولة</Label>
                  <Input
                    id="admin_reschedule_reason"
                    value={adminRescheduleReason}
                    onChange={(e) => setAdminRescheduleReason(e.target.value)}
                    required
                    minLength={5}
                    maxLength={500}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSaving || !adminRescheduleDate || adminRescheduleReason.trim().length < 5}
                  >
                    تأكيد إعادة الجدولة
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
          {/* `partially_refunded` مقصودة هنا: الطلب المركّب بيبقى جزئيًا بعد أول استرداد، والباك-إند
              بيقبل الاستردادات الباقية عادي — الشرط القديم (`paid` بس) كان بيخفي الزرار ويقفل
              استرداد بقية الدفعات من الواجهة خالص. */}
          {(order.payment_status === 'paid' || order.payment_status === 'partially_refunded') &&
            (order.order_status === 'completed' || order.order_status === 'disputed') && (
              <CardFooter className="flex-col items-stretch gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSaving}
                  onClick={() => setShowRefundForm((s) => !s)}
                >
                  استرجاع المبلغ
                </Button>
                {showRefundForm && (
                  <form onSubmit={handleRefund} className="flex flex-col gap-2">
                    {financialSummary && refundablePaymentsWithBalance.length === 0 && (
                      <p className="text-sm text-destructive">
                        مفيش دفعة عليها مبلغ متبقٍ قابل للاسترداد دلوقتي — راجع «الدفعات» و«الاستردادات» تحت
                        (استرداد قيد التأكيد مع البوابة بيحجز مبلغه لحد ما يتراجع).
                      </p>
                    )}
                    {refundablePaymentsWithBalance.length > 0 && (
                      <div>
                        <Label htmlFor="refund_payment_id">الدفعة المقصودة</Label>
                        <SelectNative
                          id="refund_payment_id"
                          value={effectiveRefundPaymentId}
                          onChange={(e) => {
                            setRefundPaymentId(e.target.value);
                            setRefundAmountEgp('');
                          }}
                        >
                          {refundablePaymentsWithBalance.length > 1 && <option value="">اختار الدفعة…</option>}
                          {refundablePaymentsWithBalance.map((row) => (
                            <option key={row.payment.id} value={row.payment.id}>
                              {refundPaymentOptionLabel(row)}
                            </option>
                          ))}
                        </SelectNative>
                        <p className="mt-1 text-xs text-muted-foreground">
                          الطلب ممكن يبقى فيه دفعة أساسية + دفعات شغل إضافي معتمد، وكل واحدة بتترد لوحدها —
                          الاسترجاع ده بيمشي على الدفعة المختارة بس.
                        </p>
                      </div>
                    )}
                    <div>
                      <Label htmlFor="refund_amount_egp">مبلغ الاسترجاع (جنيه) — فاضي = المتبقي من الدفعة كله</Label>
                      <Input
                        id="refund_amount_egp"
                        type="number"
                        min={0.01}
                        step="0.01"
                        max={selectedRefundPayment ? selectedRefundPayment.remainingCents / 100 : undefined}
                        value={refundAmountEgp}
                        onChange={(e) => setRefundAmountEgp(e.target.value)}
                        placeholder={
                          selectedRefundPayment
                            ? `الكامل: ${(selectedRefundPayment.remainingCents / 100).toFixed(2)} ج.م.`
                            : refundablePaymentsWithBalance.length > 1
                              ? 'اختار الدفعة الأول'
                              : `الكامل: ${(order.total_amount_cents / 100).toFixed(2)} ج.م.`
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="refund_reason">سبب الاسترجاع</Label>
                      <Input id="refund_reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} minLength={2} required />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      variant="destructive"
                      disabled={
                        isSaving ||
                        (!!financialSummary && refundablePaymentsWithBalance.length === 0) ||
                        (refundablePaymentsWithBalance.length > 1 && !effectiveRefundPaymentId)
                      }
                    >
                      تأكيد الاسترجاع
                    </Button>
                  </form>
                )}
              </CardFooter>
            )}
          {order.order_status === 'disputed' && !order.technician_cash_not_received_at && (
            <CardFooter className="flex-col items-stretch gap-3">
              <p className="text-sm text-muted-foreground">
                الطلب ده بلاغ زيارة فاشلة (عدم حضور/رفض شغل ضروري) — راجع الشكوى المرتبطة في صفحة الدعم
                قبل ما تقرر.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={isSaving} onClick={handleOpenRescheduleForm}>
                  العميل هيكمل — إعادة جدولة
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => setShowCancelWithFeeForm((s) => !s)}
                >
                  العميل عايز يلغي
                </Button>
              </div>
              {showRescheduleForm && (
                <form onSubmit={handleResolveFailedVisitReschedule} className="flex flex-col gap-2">
                  <div>
                    <Label htmlFor="failed_visit_reschedule_date">اليوم الجديد</Label>
                    {failedVisitRescheduleOptions === null && (
                      <p className="text-xs text-muted-foreground">جاري تحميل أيام الفني المتاحة…</p>
                    )}
                    {failedVisitRescheduleOptions !== null && (
                      <SelectNative
                        id="failed_visit_reschedule_date"
                        value={failedVisitRescheduleDate}
                        onChange={(e) => setFailedVisitRescheduleDate(e.target.value)}
                        required
                      >
                        <option value="" disabled>اختار يوم</option>
                        {failedVisitRescheduleOptions.map((option) => (
                          <option key={option.date} value={option.date} disabled={!option.available}>
                            {option.date}{option.available ? '' : ' — الفني مشغول/مش متاح'}
                          </option>
                        ))}
                      </SelectNative>
                    )}
                    {failedVisitRescheduleOptions?.every((option) => !option.available) && (
                      <p className="text-xs text-destructive">
                        الفني غير متاح في الأيام المعروضة. اختَر إعادة تعيين فني أو راجع جدول الطاقم، وليس مطلوبًا إنشاء slots يدويًا.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="reschedule_notes">ملاحظات المراجعة</Label>
                    <Input
                      id="reschedule_notes"
                      value={rescheduleNotes}
                      onChange={(e) => setRescheduleNotes(e.target.value)}
                      minLength={5}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      isSaving ||
                      !failedVisitRescheduleDate ||
                      failedVisitRescheduleOptions === null ||
                      !failedVisitRescheduleOptions.some((option) => option.date === failedVisitRescheduleDate && option.available)
                    }
                    className="w-fit"
                  >
                    تأكيد إعادة الجدولة
                  </Button>
                </form>
              )}
              {showCancelWithFeeForm && (
                <form onSubmit={handleResolveFailedVisitCancelWithFee} className="flex flex-col gap-2">
                  <div>
                    <Label htmlFor="visit_fee_egp">رسوم الزيارة (جنيه) — اختياري، افتراضي من الإعدادات</Label>
                    <Input
                      id="visit_fee_egp"
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      value={visitFeeEgp}
                      onChange={(e) => setVisitFeeEgp(e.target.value)}
                      placeholder="مثال: 50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="failed_visit_notes">ملاحظات المراجعة</Label>
                    <Input
                      id="failed_visit_notes"
                      value={failedVisitNotes}
                      onChange={(e) => setFailedVisitNotes(e.target.value)}
                      minLength={5}
                      required
                    />
                  </div>
                  {order.payment_status !== 'paid' && (
                    <p className="text-xs text-muted-foreground">
                      طلب كاش — صفر رسوم دايمًا (المنصة بتمتص تكلفة الفني)، الرسوم فوق هتتجاهل.
                    </p>
                  )}
                  <Button type="submit" size="sm" variant="destructive" disabled={isSaving} className="w-fit">
                    تأكيد الإلغاء
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
          {order.order_status === 'disputed' && order.technician_cash_not_received_at && (
            <CardFooter className="flex-col items-stretch gap-3">
              <p className="text-sm text-muted-foreground">
                نزاع تسليم كاش — الفني بلّغ إنه ماستلمش الفلوس
                {order.customer_cash_confirmed_at ? ' رغم إن العميل أكّد إنه سلّم (تعارض مباشر)' : ''}.
                راجع الشكوى المرتبطة في صفحة الدعم قبل ما تقرر.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={isSaving} onClick={handleResolveCashDisputeRetry}>
                  إعادة محاولة التحصيل
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => setShowCashDisputeConfirmForm((s) => !s)}
                >
                  تأكيد استلام الفلوس فعليًا (إداري)
                </Button>
              </div>
              {showCashDisputeConfirmForm && (
                <form onSubmit={handleResolveCashDisputeConfirmReceived} className="flex flex-col gap-2">
                  <div>
                    <Label htmlFor="cash_dispute_notes">ملاحظات المراجعة (إزاي اتأكد إن الفلوس استلمت فعلاً)</Label>
                    <Input
                      id="cash_dispute_notes"
                      value={cashDisputeNotes}
                      onChange={(e) => setCashDisputeNotes(e.target.value)}
                      minLength={5}
                      required
                    />
                  </div>
                  <Button type="submit" size="sm" variant="destructive" disabled={isSaving} className="w-fit">
                    تأكيد وتسوية الطلب
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
          {order.payment_status !== 'paid' && (
            <CardFooter className="flex-col items-stretch gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => setShowAdjustPriceForm((s) => !s)}
                className="w-fit"
              >
                تعديل السعر يدويًا
              </Button>
              {showAdjustPriceForm && (
                <form onSubmit={handleAdjustPrice} className="flex flex-col gap-2">
                  <div>
                    <Label htmlFor="new_total_egp">السعر الجديد (جنيه)</Label>
                    <Input
                      id="new_total_egp"
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      value={newTotalEgp}
                      onChange={(e) => setNewTotalEgp(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="adjust_price_reason">السبب</Label>
                    <Input
                      id="adjust_price_reason"
                      value={adjustPriceReason}
                      onChange={(e) => setAdjustPriceReason(e.target.value)}
                      minLength={5}
                      required
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={isSaving} className="w-fit">
                    حفظ السعر الجديد
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
        </Card>

        {/* بيانات العميل — كانت غايبة تمامًا عن تفاصيل الطلب للأدمن (docs/08 §73 بند 3، بلاغ
            مالك: "مركز الاتصال محتاج يعرف مين العميل ده وعنوانه من غير ما يدوّر مكان تاني").
            الاسم قابل للنقر — بيودّي لبروفايل العميل 360°. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">بيانات العميل</CardTitle>
          </CardHeader>
          <CardContent>
            <DataList>
              <DataRow label="الاسم" tone="strong">
                {/* `customer_user_id` مش `customer_id` (docs/08 §77-A1): التاني هو مُعرّف
                    البروفايل (`customer_profiles.id`)، وصفحة العميل بتاخد `users.id` — فاللينك
                    كان بيرجّع 404 دايمًا. */}
                {order.customer_user_id ? (
                  <Link
                    href={`/customers/${order.customer_user_id}`}
                    className="underline"
                    title={order.customer_user_id}
                  >
                    {order.customer_name ?? 'عرض البروفايل'}
                  </Link>
                ) : (
                  // لو السيرفر ما رجّعش الـuser id لأي سبب، بنعرض الاسم كنص بدل لينك مكسور.
                  <span>{order.customer_name ?? '—'}</span>
                )}
              </DataRow>
              {/* التليفون كان سطر سايب من غير عنوان — رقم لوحده في الكارت مش واضح هو إيه. */}
              {order.customer_phone && (
                <DataRow label="التليفون">
                  <span dir="ltr" className="inline-block">
                    {order.customer_phone}
                  </span>
                </DataRow>
              )}
              {order.address && (
                <DataRow label="العنوان">
                  {order.address.street_name}
                  {order.address.landmark ? ` — ${order.address.landmark}` : ''}
                </DataRow>
              )}
            </DataList>
          </CardContent>
        </Card>

        {/*
          ═══ تكوين سعر العميل (ADR-0107، بلاغ مالك 2026-09-17) ═══

          «صفحة الطلب لا تعطيني trace واضحًا يشرح كيف وصل السعر من ناتج الـPrice Engine إلى
          المبلغ النهائي».

          الجدول ده **مقروء من لقطة الطلب التاريخية بس** — مفيش قراءة إعدادات حيّة، فتغيير
          نسبة المنطقة أو مضاعف الفئة بعد أسبوع مايغيّرش تفسير طلب قديم.

          وتوزيع المستحقات **مش هنا**: هو كارت منفصل تحت، لأن معاملات أجر الفني/المساعد مش
          عوامل رفعت سعر العميل.
        */}
        {priceTrail && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">تكوين سعر العميل</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!priceTrail.formation_snapshot_available && (
                <Notice tone="info" className="mb-0">
                  {priceTrail.notes_ar[0] ?? 'مراحل التسعير التفصيلية مش متاحة للطلب ده.'}
                </Notice>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المرحلة</TableHead>
                    <TableHead className="text-end">المبلغ</TableHead>
                    <TableHead className="text-end">الإجمالي بعدها</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceTrail.stages.map((stage) => (
                    <TableRow key={stage.key} className={stage.applied ? undefined : 'opacity-55'}>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{stage.label_ar}</span>
                          {/* الحدود بين «سعر الشغل» و«الرسوم» بتبان بشريحة — الأدمن بيسأل
                              «الزيادة دي على الشغل نفسه ولا رسم؟» */}
                          {FORMATION_STAGE_KEYS.includes(stage.key) ? (
                            <Badge variant="outline" className="text-[10px]">سعر الشغل</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">رسوم/خصم</Badge>
                          )}
                          {!stage.applied && <Badge variant="outline" className="text-[10px]">مش مطبّقة</Badge>}
                        </div>
                        {stage.detail_ar && (
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{stage.detail_ar}</p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-end tabular-nums">
                        {stage.applied ? formatEgp(stage.amount_cents) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-end tabular-nums text-muted-foreground">
                        {formatEgp(stage.running_total_cents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { label: 'إجمالي وقت الحجز', value: priceTrail.total_at_booking_cents, tone: '' },
                  { label: 'الإجمالي المسجّل حاليًا', value: priceTrail.current_total_cents, tone: '' },
                  {
                    label: 'غير مفسَّر',
                    value: priceTrail.unexplained_cents,
                    tone: priceTrail.reconciles ? 'text-success' : 'text-destructive',
                  },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
                    <p className="text-xs leading-4 text-muted-foreground">{tile.label}</p>
                    <p className={`mt-1 font-semibold tabular-nums ${tile.tone}`}>{formatEgp(tile.value)}</p>
                  </div>
                ))}
              </div>

              {priceTrail.post_booking.length > 0 && (
                <div className="rounded-xl border border-border/70 p-3">
                  <p className="mb-2 text-sm font-semibold">تغييرات بعد الحجز</p>
                  <div className="flex flex-col gap-2">
                    {/* المفتاح فيه الترتيب: طلب عليه سلسلة عروض معتمدة بيرجّع أكتر من صف
                        بنفس `key` — واحد منهم كان هيختفي من الشبكة. */}
                    {priceTrail.post_booking.map((change, index) => (
                      <div key={`${change.key}-${index}`} className="rounded-lg border bg-muted/20 px-3 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{change.label_ar}</span>
                          <span className="text-sm font-semibold tabular-nums">{formatEgp(change.amount_cents)}</span>
                        </div>
                        {change.before_cents !== null && change.after_cents !== null && (
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            سعر الشغل: {formatEgp(change.before_cents)} ← {formatEgp(change.after_cents)}
                          </p>
                        )}
                        {change.at && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTimeAr(change.at) ?? '—'}</p>
                        )}
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{change.source_ar}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* الملاحظات بتتعرض كلها: ملاحظة «بيانات غير متوقعة» ممكن تطلع على طلب مسار
                  حسابه مقفول — إخفاؤها لأن `reconciles = true` كان بيدفن التحذير الأهم. */}
              {priceTrail.notes_ar.length > 0 && (
                <Notice
                  tone="warning"
                  title={priceTrail.reconciles ? 'ملاحظات على الشرح' : 'فيه فرق محتاج تفسير'}
                  className="mb-0"
                >
                  {priceTrail.notes_ar.length === 1 ? (
                    priceTrail.notes_ar[0]
                  ) : (
                    <ul className="list-inside list-disc space-y-1">
                      {priceTrail.notes_ar.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                </Notice>
              )}
            </CardContent>
          </Card>
        )}

        {/* الملخص المالي لكل طلب (docs/08 §20 بند 11) — كارت واحد واضح يجمع كل حاجة متبعثرة قبل
            كده: عمولة/أرباح (كانت محسوبة بس مش معروضة خالص)، وسيلة/حالة كل دفعة، وأي استرداد. */}
        {/* **عرض كامل**: الكارت ده جوّه جدول توزيع مستحقات بأربع أعمدة، وعرضه الطبيعي 561px
            جوّه نص الشبكة (398px على لابتوب 1280) — فآخر عمود «المستحق» كان بره الشاشة
            (اتقاس بـ`scripts/admin-visual.js`). */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">الملخص المالي</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!error && !financialSummary && <p className="text-muted-foreground">جاري التحميل…</p>}
            {financialSummary && (
              <>
                {/*
                  **مربّعات: العنوان فوق والرقم تحته** بدل `عنوان: رقم` في شبكة عمودين. في
                  اللقطة الحقيقية الشكل القديم كان بيطلّع «المطلوب من الفني تحصيله: 450.00 ج.م»
                  ملفوف على سطرين فالرقم بيتوه عن عنوانه، والأرقام مش متراصّة فوق بعض فمقارنة
                  مبلغين بالعين كانت مستحيلة. `tabular-nums` بيرصّ الخانات.
                */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'إجمالي الطلب', value: financialSummary.total_amount_cents, tone: '' },
                    { label: 'مدفوع فعليًا', value: financialSummary.paid_amount_cents, tone: 'text-success' },
                    ...(financialSummary.financed_order_amount_cents > 0
                      ? [{ label: 'مغطى بالتقسيط', value: financialSummary.financed_order_amount_cents, tone: '' }]
                      : []),
                    {
                      label: 'المطلوب من الفني تحصيله',
                      value: financialSummary.amount_due_to_technician_cents,
                      tone: financialSummary.amount_due_to_technician_cents > 0 ? 'text-amber-700' : 'text-success',
                    },
                    ...(financialSummary.refunded_amount_cents > 0
                      ? [{ label: 'مسترد فعليًا', value: financialSummary.refunded_amount_cents, tone: 'text-destructive' }]
                      : []),
                    { label: 'عمولة المنصة', value: financialSummary.platform_commission_cents, tone: '' },
                    { label: 'أرباح الفني', value: financialSummary.technician_earning_cents, tone: '' },
                    ...(financialSummary.cancellation_fee_cents > 0
                      ? [{ label: 'رسوم إلغاء', value: financialSummary.cancellation_fee_cents, tone: 'text-destructive' }]
                      : []),
                  ].map((tile) => (
                    <div key={tile.label} className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
                      <p className="text-xs leading-4 text-muted-foreground">{tile.label}</p>
                      <p className={`mt-1 font-semibold tabular-nums ${tile.tone}`}>{formatEgp(tile.value)}</p>
                    </div>
                  ))}
                </div>
                {financialSummary.installment_outstanding_cents > 0 && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    باقي جدول التقسيط على العميل: {formatEgp(financialSummary.installment_outstanding_cents)} — تحصّله المنصة، وليس الفني.
                  </p>
                )}

                <div className="rounded-md border">
                  <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
                    <div>
                      <p className="font-medium">
                        {earningShares?.[0]?.is_preview ? 'معاينة توزيع المستحقات' : 'توزيع مستحقات أفراد الطاقم'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {earningShares?.[0]?.is_preview
                          ? 'تقدير حي من نفس محرك التسوية، وقد يتغير قبل الإقفال'
                          : 'Snapshot نهائي غير قابل للتغيير - بيانات داخلية للأدمن فقط'}
                      </p>
                    </div>
                    {!!earningShares?.length && (
                      <div className="text-end">
                        <p className="font-semibold">
                          موزع: {formatEgp(earningShares.reduce((total, share) => total + share.share_cents, 0))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          الوعاء: {formatEgp(earningShares[0].pool_cents)} ·{' '}
                          {earningShares.reduce((total, share) => total + share.share_cents, 0) === earningShares[0].pool_cents
                            ? 'متطابق'
                            : 'يحتاج مراجعة'}
                        </p>
                      </div>
                    )}
                  </div>
                  {earningShares === null && (
                    <p className="p-3 text-muted-foreground">جاري تحميل توزيع المستحقات…</p>
                  )}
                  {earningSharesError && (
                    <p className="p-3 text-destructive">تعذّر تحميل توزيع المستحقات. حاول تحديث الصفحة.</p>
                  )}
                  {!earningSharesError && earningShares?.length === 0 && (
                    <p className="p-3 text-muted-foreground">
                      لا يمكن إنشاء معاينة حتى يتم تعيين قائد للطلب.
                    </p>
                  )}
                  {!!earningShares?.length && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الفرد</TableHead>
                          <TableHead>الدور</TableHead>
                          <TableHead>المستوى / طريقة الحساب</TableHead>
                          <TableHead>المستحق</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {earningShares.map((share) => (
                          <TableRow key={share.technician_id}>
                            <TableCell>
                              <Link href={`/technicians/${share.technician_id}`} className="font-medium underline">
                                {share.full_name}
                              </Link>
                            </TableCell>
                            <TableCell>{EARNING_SHARE_ROLE_LABELS[share.participant_role]}</TableCell>
                            <TableCell>
                              <p>
                                {(LEVEL_LABELS as Record<string, string>)[share.technician_level] ?? share.technician_level}
                              </p>
                              {share.calculation_method === 'earnings_policy_v2' ? (
                                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                  <p>
                                    V2 · {share.earning_role === 'assistant' ? 'مساعد' : 'فني'} · مهارة{' '}
                                    {share.service_skill_snapshot ?? 'قياسية'}
                                  </p>
                                  <p>
                                    وزن المستوى {((share.level_weight_bps_snapshot ?? 10000) / 10000).toFixed(2)}
                                    {share.earning_role === 'assistant' &&
                                      ` × نسبة مساعد ${((share.assistant_ratio_bps_snapshot ?? 10000) / 100).toFixed(2)}%`}
                                    {' × '}مهارة {((share.service_skill_factor_bps_snapshot ?? 10000) / 10000).toFixed(2)}
                                  </p>
                                  {(share.individual_adjustment_bps_snapshot !== 0 || share.order_adjustment_bps_snapshot !== 0) && (
                                    <p>
                                      تعديل فردي {((share.individual_adjustment_bps_snapshot ?? 0) / 100).toFixed(2)}% · طلب{' '}
                                      {((share.order_adjustment_bps_snapshot ?? 0) / 100).toFixed(2)}%
                                    </p>
                                  )}
                                </div>
                              ) : share.calculation_method === 'assistant_level_wage' ? (
                                <p className="text-xs text-muted-foreground">
                                  أساس {formatEgp(share.assistant_base_wage_cents ?? 0)} ×{' '}
                                  {Number(share.assistant_level_multiplier ?? 1).toLocaleString('ar-EG')} ={' '}
                                  {formatEgp(share.assistant_target_cents ?? share.share_cents)}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  توزيع بالوزن {Number(share.share_weight).toLocaleString('ar-EG')}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="font-semibold">{formatEgp(share.share_cents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {/* استثناء على الطلب ده بالذات (docs/08 §136) — القسم بيتعطّل بنفسه بعد
                      إقفال التسوية، لأن الحصص ساعتها snapshot ثابت ومفيش استثناء بيحرّكه. */}
                  <OrderEarningAdjustmentsSection
                    authedFetch={authedFetch}
                    orderId={id}
                    participants={adjustmentParticipants}
                    onChanged={loadEarningShares}
                  />
                </div>

                <div>
                  <p className="mb-1 font-medium">الدفعات ({financialSummary.payments.length})</p>
                  {financialSummary.payments.length === 0 && (
                    <p className="text-muted-foreground">مفيش دفعات مسجّلة لسه</p>
                  )}
                  {financialSummary.payments.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {financialSummary.payments.map((p) => (
                        <li key={p.id} className="flex flex-col gap-0.5 border-b pb-1 text-xs last:border-0">
                          <div className="flex items-center justify-between">
                            <span>
                              {PAYMENT_METHOD_LABELS_FULL[p.payment_method]} ·{' '}
                              {PAYMENT_GATEWAY_STATUS_LABELS[p.payment_status]}
                              {p.order_item_batch_id && (
                                <span className="ms-1 rounded bg-muted px-1 py-0.5 text-muted-foreground">
                                  دفعة شغل إضافي معتمد
                                </span>
                              )}
                            </span>
                            <span>{formatEgp(p.amount_cents)}</span>
                          </div>
                          {(p.payment_status === 'failed' || p.payment_status === 'manual_review') && p.failure_message && (
                            <span className="text-destructive">تعذّر التحصيل: {p.failure_message}</span>
                          )}
                          {p.payment_status === 'manual_review' && (
                            <span className="text-amber-700">
                              لا تُنشأ محاولة تحصيل أو استرداد تلقائيًا. راجع نتيجة البوابة أولًا، ثم استخدم الاسترداد اليدوي فقط إذا ثبت تحصيل مكرر.
                            </span>
                          )}
                          {/* بَقّة حقيقية اتلقطت — العميل مكانش عنده طريقة يسجّل بيها "أنا حوّلت" غير
                              polling محلي بلا أثر على السيرفر. customer_confirmed_transfer_at بيفرّق
                              للأدمن بين دفعة محدش لمسها ودفعة العميل بيدّعي إنه حوّلها فعلاً. */}
                          {p.payment_method === 'instapay' &&
                            p.payment_status === 'pending' &&
                            p.customer_confirmed_transfer_at && (
                              <span className="text-amber-600">
                                العميل قال إنه حوّل الفلوس ({new Date(p.customer_confirmed_transfer_at).toLocaleString('ar-EG')}) — محتاج مراجعة
                              </span>
                            )}
                          {/* §24 — كانت فجوة موثّقة: POST /admin/payments/:id/confirm-instapay موجود ومختبر
                              من زمان (ADR-0013 §7) بس صفر زرار له في أي شاشة — إنستاباي طريقة دفع حقيقية
                              كانت مقفولة عمليًا بلا واجهة أدمن تقفل الدورة. */}
                          {p.payment_method === 'instapay' && p.payment_status === 'pending' && (
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isSaving}
                                onClick={() => handleConfirmInstaPay(p.id)}
                              >
                                تأكيد استلام تحويل إنستاباي
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={isSaving}
                                onClick={() => {
                                  setRejectInstaPayPaymentId(p.id);
                                  setRejectInstaPayReason('');
                                }}
                              >
                                رفض التحويل
                              </Button>
                            </div>
                          )}
                          {/* رفض دفعة InstaPay معلّقة (مقابل التأكيد فوق) — كانت فجوة حقيقية، endpoint
                              رفض مالوش أي واجهة خالص قبل كده. */}
                          {rejectInstaPayPaymentId === p.id && (
                            <form onSubmit={handleRejectInstaPay} className="flex flex-col gap-2">
                              <Label htmlFor={`reject_instapay_reason_${p.id}`}>سبب الرفض</Label>
                              <Input
                                id={`reject_instapay_reason_${p.id}`}
                                value={rejectInstaPayReason}
                                onChange={(e) => setRejectInstaPayReason(e.target.value)}
                                minLength={2}
                                required
                              />
                              <div className="flex gap-2">
                                <Button type="submit" size="sm" variant="destructive" disabled={isSaving}>
                                  تأكيد الرفض
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRejectInstaPayPaymentId(null)}
                                >
                                  إلغاء
                                </Button>
                              </div>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {financialSummary.refunds.length > 0 && (
                  <div>
                    <p className="mb-1 font-medium">الاستردادات ({financialSummary.refunds.length})</p>
                    <ul className="flex flex-col gap-1">
                      {financialSummary.refunds.map((r) => (
                        <li key={r.id} className="flex flex-col gap-2 border-b pb-2 text-xs last:border-0">
                          <div className="flex items-center justify-between">
                            <span>
                              {REFUND_METHOD_LABELS[r.refund_method]} · {REFUND_STATUS_LABELS[r.refund_status]}
                            </span>
                            <span className="text-destructive">-{formatEgp(r.amount_cents)}</span>
                          </div>
                          {/* الطلب المركّب بيبقى فيه أكتر من دفعة، فرقم استرداد بلا دفعة = رقم بلا معنى. */}
                          {financialSummary.payments.length > 1 && (
                            <span className="text-muted-foreground">
                              من:{' '}
                              {(() => {
                                const source = financialSummary.payments.find((p) => p.id === r.payment_id);
                                if (!source) return 'دفعة غير معروضة';
                                const kind = refundPaymentKindLabel(source);
                                return `${source.payment_number} (${formatEgp(source.amount_cents)})${kind ? ` — ${kind}` : ''}`;
                              })()}
                            </span>
                          )}
                          {r.refund_status === 'processing' && r.refund_method === 'original_method' && (
                            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950">
                              <p>
                                النتيجة عند البوابة غير مؤكدة. لا تُنشئ استردادًا آخر؛ راجع لوحة المزود ثم اقفل نفس العملية بدليل.
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                disabled={isSaving}
                                onClick={() => {
                                  setReconcilingRefundId(reconcilingRefundId === r.id ? null : r.id);
                                  setRefundReconciliationOutcome('confirmed');
                                  setRefundProviderReference('');
                                  setRefundReconciliationEvidence('');
                                }}
                              >
                                مراجعة نتيجة الاسترداد
                              </Button>
                              {reconcilingRefundId === r.id && (
                                <form onSubmit={handleRefundReconciliation} className="mt-2 flex flex-col gap-2">
                                  <Label htmlFor={`refund_reconciliation_outcome_${r.id}`}>نتيجة مراجعة البوابة</Label>
                                  <SelectNative
                                    id={`refund_reconciliation_outcome_${r.id}`}
                                    value={refundReconciliationOutcome}
                                    onChange={(event) => setRefundReconciliationOutcome(event.target.value as 'confirmed' | 'rejected')}
                                  >
                                    <option value="confirmed">تم الاسترداد فعليًا</option>
                                    <option value="rejected">البوابة رفضت الاسترداد صراحة</option>
                                  </SelectNative>
                                  {refundReconciliationOutcome === 'confirmed' && (
                                    <Input
                                      value={refundProviderReference}
                                      onChange={(event) => setRefundProviderReference(event.target.value)}
                                      placeholder="مرجع استرداد البوابة"
                                      minLength={3}
                                      required
                                    />
                                  )}
                                  <Input
                                    value={refundReconciliationEvidence}
                                    onChange={(event) => setRefundReconciliationEvidence(event.target.value)}
                                    placeholder="الدليل: رابط/رقم عملية أو ملاحظة من لوحة المزود"
                                    minLength={8}
                                    required
                                  />
                                  <div className="flex gap-2">
                                    <Button type="submit" size="sm" disabled={isSaving}>تأكيد القرار الموثق</Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => setReconcilingRefundId(null)}>إلغاء</Button>
                                  </div>
                                </form>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/*
          **مدة الشغلانة للأدمن — نفس اللي العميل شافه** (ADR-0102، docs/08 §157).

          بلاغ المالك: «مدة الشغلانة نفسها مش بتظهر للأدمين». الكارت ده كان بيقرا
          `pricing_evaluation.computed_duration_days` وبس — وهي بالأيام، و`pricing_evaluation`
          نفسها `null` لأي خدمة مش `pricing_model=formula`. فالأدمن كان بيشوف «—» في أكتر
          حالتين شائعتين: خدمة مش معادلية، وشغلانة مدتها بالساعات.

          الـsnapshot كان **موجود على الطلب من الأول** (`duration_minutes`/
          `estimated_duration_days`) والعميل بيقراه بنفس الحقول. فمفيش حساب جديد هنا —
          نفس الحقول ونفس دالة الصياغة (`formatWorkDuration` من `@baytak/shared-types`).
        */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">المدة والطاقم</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DataList>
              <DataRow label="المدة المقدّرة عند الحجز" tone="strong">
                {formatWorkDuration(order.duration_minutes, order.estimated_duration_days) ?? '—'}
              </DataRow>
              {order.scheduled_at && <DataRow label="موعد البداية">{formatDateTimeAr(order.scheduled_at) ?? '—'}</DataRow>}
              {order.scheduled_at && order.duration_minutes !== null && order.duration_minutes > 0 && (
                <DataRow label="النهاية المتوقعة">
                  {/* كان `toLocaleString('ar-EG-u-nu-latn')` خام فبيطلّع «12:00:00 2026/9/17 م»
                      — ثواني ملهاش لازمة وترتيب متلخبط. `formatDateTimeAr` هو نفس الصيغة
                      المستخدمة في كل اللوحة. */}
                  {formatDateTimeAr(
                    new Date(new Date(order.scheduled_at).getTime() + order.duration_minutes * 60_000),
                  ) ?? '—'}
                </DataRow>
              )}
              <DataRow label="الطاقم المطلوب">
                {formatWorkforce(order.required_technicians, order.required_assistants) ?? '—'}
              </DataRow>
            </DataList>

            {/*
              **المدة الفعلية بلوك منفصل** عن التقدير عن قصد (طلب المالك: «وبعد انتهاء الطلب
              ممكن يبقى عندنا سطر منفصل اسمه المدة الفعلية. كده ما نخلطش بين تقدير الحجز وما
              حدث بالفعل»). بيظهر بس لما الشغل يبدأ فعلاً.
            */}
            {order.work_started_at && (
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">المدة الفعلية</p>
                <p className="mt-0.5 text-sm font-semibold">
                  {order.work_completed_at
                    ? (formatWorkDuration(
                        Math.round(
                          (new Date(order.work_completed_at).getTime() -
                            new Date(order.work_started_at).getTime()) /
                            60_000,
                        ),
                        null,
                      ) ?? '—')
                    : 'الشغل لسه شغّال'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  بدأ {formatDateTimeAr(order.work_started_at) ?? '—'}
                </p>
              </div>
            )}

            {/*
              مصدر التقدير — معلومة تشخيصية للأدمن («الرقم ده جا منين؟»)، مش مصدر العرض.
              العرض فوق بيقرا الـsnapshot على الطلب دايمًا.
            */}
            <p className="text-xs leading-5 text-muted-foreground">
              {order.pricing_evaluation
                ? `المصدر: معادلة تسعير الخدمة، محسوبة وقت الحجز في ${formatDateTimeAr(order.pricing_evaluation.created_at) ?? '—'}`
                : order.standard_data_id
                  ? 'المصدر: بيانات الإنتاجية القياسية للخدمة (service_standard_data)'
                  : 'المصدر: المدة الافتراضية للخدمة من الكتالوج — الخدمة دي مش بتستخدم معادلة تسعير ولا بيانات قياسية'}
            </p>
          </CardContent>
        </Card>

        {/* docs/08 §108-A — نتيجة آخر تعيين مساعد/عضو طاقم: فورًا ولا فرصة مستنية قبول. */}
        {crewAssignOutcome && (
          <div
            className={
              crewAssignOutcome.isOffer
                ? 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning'
                : 'rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success'
            }
          >
            {crewAssignOutcome.message}
          </div>
        )}

        {/* تعيين مساعد يدوي بعد التصعيد (ADR-0008) — بيظهر بس لو الطلب أصلاً محتاج مساعدين. */}
        {!!order.required_assistants && order.required_assistants > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المساعدين ({assistantMembers.length}/{order.required_assistants})</CardTitle>
            </CardHeader>
            <CardContent>
              {assistantMembers.length === 0 ? (
                <EmptyState title="مفيش مساعد معيّن لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>الدور</TableHead>
                      <TableHead>اتعيّن إمتى</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assistantMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>{member.full_name}</TableCell>
                        <TableCell>{member.role_label}</TableCell>
                        <TableCell>{(formatDateTimeAr(member.created_at) ?? '—')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {assistantMembers.length < order.required_assistants && (
              <CardFooter className="flex-col items-stretch gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  className="w-fit"
                  onClick={() => {
                    setShowAssignAssistantForm((s) => !s);
                    if (!eligibleAssistants) loadEligibleAssistants();
                  }}
                >
                  عيّن مساعد يدويًا
                </Button>
                {showAssignAssistantForm && (
                  <form onSubmit={handleAssignAssistant} className="flex flex-col gap-2">
                    <Label htmlFor="assistant_technician_id">الفني</Label>
                    {!eligibleAssistants ? (
                      <p className="text-sm text-muted-foreground">بيحمّل المساعدين المؤهلين لنفس التخصص والمدينة…</p>
                    ) : (
                      <SelectNative
                        id="assistant_technician_id"
                        value={assistantTechnicianId}
                        onChange={(e) => setAssistantTechnicianId(e.target.value)}
                        required
                      >
                        <option value="" disabled>
                          اختار فني
                        </option>
                        {eligibleAssistants.map((assistant) => (
                          <option key={assistant.technician_id} value={assistant.technician_id}>
                            {assistant.full_name} ({assistant.technician_code})
                            {assistant.distance_km !== null ? ` — ${Number(assistant.distance_km).toFixed(1)} كم` : ''}
                            {/* docs/08 §108-A — <option> HTML مالوش أيقونات، فالتمييز نصي: أي فني
                                مش LIGHT بيوضّح إنه هيتحوّل لعرض بدل إضافة فورية قبل ما الأدمن يختاره. */}
                            {assistant.capacity_tier !== 'LIGHT' ? ` — ${CAPACITY_TIER_LABELS[assistant.capacity_tier]} (هيتبعتله عرض)` : ''}
                          </option>
                        ))}
                      </SelectNative>
                    )}
                    <Button type="submit" size="sm" disabled={isSaving || !assistantTechnicianId}>
                      تأكيد التعيين
                    </Button>
                  </form>
                )}
              </CardFooter>
            )}
          </Card>
        )}

        {/* إدارة طاقم الطلب من الأدمن (Script 4 §22-29, §38-41) — بيظهر بس لطلبات "اعتماد" (فريق). */}
        {order.booking_mode === 'team' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">طاقم الطلب ({crewMembers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {crewShortageWarning && (
                <p className="mb-3 text-sm text-destructive">
                  تحذير: عدد الطاقم بعد آخر تغيير أقل من المطلوب ({order.required_technicians ?? '—'}).
                </p>
              )}
              {crewMembers.length === 0 ? (
                <EmptyState title="مفيش أعضاء طاقم مضافين لسه" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الدور</TableHead>
                      <TableHead>اتضاف إمتى</TableHead>
                      {hasPermission('orders.manage_crew') && <TableHead>إجراءات</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {crewMembers.map((member) => (
                      <Fragment key={member.id}>
                        <TableRow>
                          <TableCell>{member.full_name}</TableCell>
                          <TableCell>
                            <Badge variant={member.member_type === 'assistant' ? 'secondary' : 'outline'}>
                              {member.member_type === 'assistant' ? 'مساعد' : 'فني'}
                            </Badge>
                          </TableCell>
                          <TableCell>{member.role_label}</TableCell>
                          <TableCell>{(formatDateTimeAr(member.created_at) ?? '—')}</TableCell>
                          {hasPermission('orders.manage_crew') && (
                            <TableCell>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setRemovingCrewMemberId((cur) => (cur === member.id ? null : member.id));
                                    setReplacingCrewMemberId(null);
                                    setRemoveCrewReason('');
                                  }}
                                >
                                  إزالة
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setReplacingCrewMemberId((cur) => (cur === member.id ? null : member.id));
                                    setRemovingCrewMemberId(null);
                                    setReplaceCrewTechnicianId('');
                                    setReplaceCrewReason('');
                                    setReplaceCrewRoleLabel('');
                                    if (!approvedTechnicians) loadApprovedTechnicians();
                                  }}
                                >
                                  استبدال
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {removingCrewMemberId === member.id && (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <form onSubmit={(e) => handleRemoveCrewMember(e, member.id)} className="flex flex-col gap-2">
                                <Label htmlFor={`remove_reason_${member.id}`}>سبب الإزالة</Label>
                                <Input
                                  id={`remove_reason_${member.id}`}
                                  value={removeCrewReason}
                                  onChange={(e) => setRemoveCrewReason(e.target.value)}
                                  required
                                  minLength={5}
                                  maxLength={500}
                                />
                                <div className="flex gap-2">
                                  <Button type="submit" size="sm" variant="destructive" disabled={isSaving || removeCrewReason.length < 5}>
                                    تأكيد الإزالة
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setRemovingCrewMemberId(null);
                                      setRemoveCrewReason('');
                                    }}
                                  >
                                    إلغاء
                                  </Button>
                                </div>
                              </form>
                            </TableCell>
                          </TableRow>
                        )}
                        {replacingCrewMemberId === member.id && (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <form onSubmit={(e) => handleReplaceCrewMember(e, member.id)} className="flex flex-col gap-2">
                                <Label htmlFor={`replace_tech_${member.id}`}>الفني الجديد</Label>
                                {!approvedTechnicians ? (
                                  <p className="text-sm text-muted-foreground">بيحمّل قايمة الفنيين…</p>
                                ) : (
                                  <SelectNative
                                    id={`replace_tech_${member.id}`}
                                    value={replaceCrewTechnicianId}
                                    onChange={(e) => setReplaceCrewTechnicianId(e.target.value)}
                                    required
                                  >
                                    <option value="" disabled>
                                      اختار فني
                                    </option>
                                    {approvedTechnicians.map((tech) => (
                                      <option key={tech.id} value={tech.id}>
                                        {tech.full_name} ({tech.technician_code})
                                      </option>
                                    ))}
                                  </SelectNative>
                                )}
                                <Label htmlFor={`replace_role_${member.id}`}>الدور (اختياري، هياخد دور العضو القديم لو فاضي)</Label>
                                <Input
                                  id={`replace_role_${member.id}`}
                                  value={replaceCrewRoleLabel}
                                  onChange={(e) => setReplaceCrewRoleLabel(e.target.value)}
                                  maxLength={100}
                                />
                                <Label htmlFor={`replace_reason_${member.id}`}>سبب الاستبدال</Label>
                                <Input
                                  id={`replace_reason_${member.id}`}
                                  value={replaceCrewReason}
                                  onChange={(e) => setReplaceCrewReason(e.target.value)}
                                  required
                                  minLength={5}
                                  maxLength={500}
                                />
                                <div className="flex gap-2">
                                  <Button type="submit" size="sm" disabled={isSaving || !replaceCrewTechnicianId || replaceCrewReason.length < 5}>
                                    تأكيد الاستبدال
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setReplacingCrewMemberId(null);
                                      setReplaceCrewTechnicianId('');
                                      setReplaceCrewReason('');
                                      setReplaceCrewRoleLabel('');
                                    }}
                                  >
                                    إلغاء
                                  </Button>
                                </div>
                              </form>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {hasPermission('orders.manage_crew') && (
              <CardFooter className="flex-col items-stretch gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={isSaving}
                  onClick={() => {
                    setShowAddCrewForm((s) => !s);
                    if (!approvedTechnicians) loadApprovedTechnicians();
                  }}
                >
                  إضافة عضو طاقم
                </Button>
                {showAddCrewForm && (
                  <form onSubmit={handleAddCrewMember} className="flex flex-col gap-2">
                    <Label htmlFor="crew_technician_id">الفني</Label>
                    {!approvedTechnicians ? (
                      <p className="text-sm text-muted-foreground">بيحمّل قايمة الفنيين…</p>
                    ) : (
                      <SelectNative id="crew_technician_id" value={crewTechnicianId} onChange={(e) => setCrewTechnicianId(e.target.value)} required>
                        <option value="" disabled>
                          اختار فني
                        </option>
                        {approvedTechnicians.map((tech) => (
                          <option key={tech.id} value={tech.id}>
                            {tech.full_name} ({tech.technician_code})
                          </option>
                        ))}
                      </SelectNative>
                    )}
                    <Label htmlFor="crew_member_type">نوع العضو</Label>
                    <SelectNative
                      id="crew_member_type"
                      value={crewMemberType}
                      onChange={(e) => setCrewMemberType(e.target.value === 'assistant' ? 'assistant' : 'team_member')}
                    >
                      <option value="team_member">فني</option>
                      <option value="assistant">مساعد</option>
                    </SelectNative>
                    <p className="text-xs text-muted-foreground">
                      النوع ده هو اللي بيسدّ النقص في &quot;حالة الطاقم&quot; — الدور تحت وصف للعرض بس.
                    </p>
                    <Label htmlFor="crew_role_label">الدور</Label>
                    <Input id="crew_role_label" value={crewRoleLabel} onChange={(e) => setCrewRoleLabel(e.target.value)} required minLength={2} maxLength={100} />
                    <Button type="submit" size="sm" disabled={isSaving || !crewTechnicianId || !crewRoleLabel}>
                      تأكيد الإضافة
                    </Button>
                  </form>
                )}
              </CardFooter>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">تقييمات الطلب</CardTitle>
          </CardHeader>
          <CardContent>
            {ratings.length === 0 ? (
              <EmptyState title="الطلب لسه ما اتقيّمش" />
            ) : (
              <div className="flex flex-col gap-4">
                {ratings.map((rating) => (
                  <div key={rating.id} className="rounded-lg border p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="secondary">
                        {rating.rating_type === 'customer_to_technician' ? 'العميل قيّم الفني' : 'الفني قيّم العميل'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {(formatDateTimeAr(rating.created_at) ?? '—')}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ['التقييم العام', rating.overall_rating],
                        ['الالتزام بالمواعيد', rating.punctuality_rating],
                        ['جودة الشغل', rating.quality_rating],
                        ['الاحترافية', rating.professionalism_rating],
                        ['عدالة السعر', rating.price_fairness_rating],
                        ['النظافة', rating.cleanliness_rating],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                          <span>{label}</span>
                          <strong>{value === null ? 'لم يُقيّم' : `${value} / 5`}</strong>
                        </div>
                      ))}
                    </div>
                    {rating.comment && <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{rating.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">تاريخ الحالة</CardTitle>
          </CardHeader>
          <CardContent>
            {order.status_history.length === 0 ? (
              <EmptyState title="مفيش سجل" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>من</TableHead>
                    <TableHead>إلى</TableHead>
                    <TableHead>الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.status_history.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.previous_status ? ORDER_STATUS_LABELS[entry.previous_status] : '—'}</TableCell>
                      <TableCell>{ORDER_STATUS_LABELS[entry.new_status]}</TableCell>
                      <TableCell>{(formatDateTimeAr(entry.created_at) ?? '—')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>


        {order.technician_cancellations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">إلغاءات الفني (سياسة إلغاء الفني)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>وقت الإلغاء</TableHead>
                    <TableHead>بعد القبول بـ</TableHead>
                    <TableHead>جوّه النافذة؟</TableHead>
                    <TableHead>إجراء الاسترجاع</TableHead>
                    <TableHead>الرسوم</TableHead>
                    <TableHead>السبب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.technician_cancellations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{(formatDateTimeAr(c.cancelled_at) ?? '—')}</TableCell>
                      <TableCell>{Math.round(c.elapsed_seconds_after_acceptance / 60)} دقيقة</TableCell>
                      <TableCell>{c.within_policy_window ? 'أيوه' : 'لأ (متأخر)'}</TableCell>
                      <TableCell>
                        {c.recovery_action === 'auto_rematch' ? 'إعادة مطابقة تلقائية' : 'محتاج العميل يختار بديل'}
                      </TableCell>
                      <TableCell>{c.fee_cents > 0 ? `${c.fee_cents / 100} ج.م.` : '—'}</TableCell>
                      <TableCell>{c.reason_text ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {order.customer_cancellation && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">إلغاء العميل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">السبب المختار:</span> {order.customer_cancellation.reason_ar ?? 'لم يختر سببًا من القائمة'}</p>
              {order.customer_cancellation.note && (
                <p><span className="text-muted-foreground">ملاحظة العميل:</span> {order.customer_cancellation.note}</p>
              )}
              <p><span className="text-muted-foreground">رسوم الإلغاء:</span> {order.customer_cancellation.fee_cents > 0 ? formatEgp(order.customer_cancellation.fee_cents) : 'لا توجد رسوم'}</p>
              {order.customer_cancellation.cancelled_at && (
                <p className="text-xs text-muted-foreground">وقت الإلغاء: {(formatDateTimeAr(order.customer_cancellation.cancelled_at) ?? '—')}</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">بنود عرض السعر</CardTitle>
          </CardHeader>
          <CardContent>
            {quoteItems.length === 0 ? (
              <EmptyState title="مفيش بنود إضافية اتقترحت على الطلب ده" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>البند</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quoteItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.name_ar}
                        <span className="block text-xs text-muted-foreground">
                          {item.quantity} {item.unit_name ?? ''} × {formatEgp(item.unit_price_cents)}
                        </span>
                      </TableCell>
                      <TableCell>{ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}</TableCell>
                      <TableCell>{formatEgp(item.total_price_cents)}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_customer_approved ? 'secondary' : 'outline'}>
                          {item.is_customer_approved ? 'موافَق عليه' : 'معلّق'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">صور الطلب</CardTitle>
            {hasPermission('orders.adjust_price') && (
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-normal hover:bg-muted/50">
                {uploadingProblemImages ? 'جاري الرفع…' : 'إضافة صورة مشكلة'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  disabled={uploadingProblemImages}
                  onChange={(event) => {
                    void handleAdminProblemImages(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
            )}
          </CardHeader>
          <CardContent>
            {media.length === 0 ? (
              <EmptyState title="مفيش صور اترفعت للطلب ده لسه" />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {media.map((item) => (
                  <a
                    key={item.id}
                    href={resolveMediaUrl(item.file_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ملف من سيرفر الباك-إند نفسه، مش next/image محتاجة config لأصل خارجي */}
                    <img
                      src={resolveMediaUrl(item.file_url)}
                      alt={MEDIA_TYPE_LABELS[item.media_type] ?? item.media_type}
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                    <span className="text-xs text-muted-foreground">
                      {MEDIA_TYPE_LABELS[item.media_type] ?? item.media_type}
                    </span>
                    {item.caption && <span className="text-xs">{item.caption}</span>}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* شكاوى/ضمان مرتبطين بالطلب (docs/08 §73 بند 3 المؤجّل — الجزء ده اتفعّل) — عرض بس،
            مركز الاتصال يشوف بسرعة هل الطلب ده وراه شكوى/مطالبة ضمان مفتوحة قبل ما يتصرف فيه،
            بدل ما يدوّر في شاشتين منفصلتين. الإجراءات نفسها (رد/حل/مراجعة) في الشاشات العامة. */}
        {(linkedComplaints.length > 0 || linkedWarrantyClaims.length > 0) && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                شكاوى وضمان مرتبطين بالطلب ({linkedComplaints.length + linkedWarrantyClaims.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {linkedComplaints.map((c) => (
                <Link
                  key={c.id}
                  href={`/support/${c.id}`}
                  className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted/50"
                >
                  <span>شكوى: {c.title}</span>
                  <StatusChip tone={complaintStatusTone(c.complaint_status)}>
                    {COMPLAINT_STATUS_LABELS[c.complaint_status]}
                  </StatusChip>
                </Link>
              ))}
              {linkedWarrantyClaims.map((w) => (
                <Link
                  key={w.id}
                  href="/warranty-claims"
                  className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted/50"
                >
                  <span>مطالبة ضمان: {w.defect_description}</span>
                  <Badge variant="outline">{w.status}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ملاحظات داخلية لمركز الاتصال (docs/08 §73 بند 3، بلاغ مالك صريح: "ملاحظات داخلية
            للكول سنتر لا يراها العميل أو الفني") — نفس نمط is_internal_note في الشكاوى، بس هنا
            جدول مستقل تمامًا (العميل/الفني مالهومش أي endpoint يوصل له خالص). */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">ملاحظات داخلية ({internalNotes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddInternalNote} className="mb-4 flex flex-col gap-2 sm:flex-row">
              <Input
                value={newInternalNote}
                onChange={(e) => setNewInternalNote(e.target.value)}
                placeholder="اكتب ملاحظة داخلية عن الطلب ده — مش هتظهر للعميل ولا الفني"
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={isSavingNote || !newInternalNote.trim()}>
                {isSavingNote ? 'جاري الحفظ…' : 'إضافة ملاحظة'}
              </Button>
            </form>
            {internalNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش ملاحظات داخلية لسه</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {internalNotes.map((n) => (
                  <li key={n.id} className="rounded-md border p-2 text-sm">
                    <p>{n.note}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.author_full_name ?? 'موظف'} — {(formatDateTimeAr(n.created_at) ?? '—')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        **البَقّة الحقيقية اللي خلّت المالك «مش شايف التوزيع»** (2026-09-19).

        الكارتين دول (التسلسل الزمني + مفتّش المطابقة) اتنقلوا لآخر الصفحة في جولة التنظيم
        (§158) — بس اتحطّوا **جوّه فرع `if (error && !order)`** بالغلط، يعني بيترندروا بس لما
        الطلب نفسه يفشل في التحميل. على أي صفحة طلب شغّالة كانوا **مش موجودين في الـDOM خالص**.

        `tsc`/`eslint`/`next build` كلهم عدّوا: الكود سليم نحويًا، بس في الفرع الغلط. اللي مسكها
        هو `scripts/visual-matching-inspector.js` — بيدوّر على عناوين الأقسام في نص الصفحة
        الحقيقي بعد تسجيل دخول حقيقي، فـ«الكارت مش موجود في الصفحة خالص» طلعت صريحة.
      */}
      {/*
        **أدوات التشخيص في آخر الصفحة عن قصد** (بلاغ مالك 2026-09-17).

        الكارتين دول (التسلسل الزمني + مفتّش المطابقة) كانوا **أول حاجة** في الصفحة، قبل
        بيانات الطلب والعميل والفلوس. فموظف العمليات اللي فاتح الطلب عشان يعرف «مين العميل
        وإيه الخدمة وامتى الموعد» كان بيقابل أول ما يفتح: «Timeline (0)» فاضي، وبعده جدول
        `order_assignments` وصفوف أصفار وبادجات تشخيصية كتيفة. ده بالظبط «كلام مش معروف
        الكلام ده متلخبط على بعضه».

        هما **مهمين ومابيتشالوش** — بس مكانهم بعد الأساسيات: الأدمن بيوصلهم لما يكون بيسأل
        «ليه الطلب بيتصرّف كده؟» مش لما يكون بيسأل «الطلب ده بتاع مين؟».
      */}
      {/* Timeline موحّد (Script 4 Part G §30-32) — جنب كروت "تاريخ الحالة"/"إلغاءات الفني"
          المتخصصة تحت، مش بديل عنهم. القيمة المضافة: بيورّي audit_log وorder_assignments كمان
          (مفيش كارت كان بيعرضهم في صفحة الطلب أصلاً) في نفس التسلسل الزمني. */}
      <Card className="mb-6">
        <CardHeader>
          {/* «Timeline» كانت إنجليزي وسط واجهة عربية بالكامل — بلاغ المالك عن «كلام عربي على
              إنجليزي». الاسم العربي هو نفس المعنى بالظبط. */}
          <CardTitle className="text-base">التسلسل الزمني للطلب ({timeline.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <EmptyState title="مفيش أحداث مسجّلة لسه" />
          ) : (
            <ul className="flex flex-col gap-3">
              {timeline.map((event) => {
                const reason = event.detail?.reason;
                const reasonText = event.detail?.reason_text;
                const actorTypeLabel =
                  event.actor_user_type === 'admin' ? 'أدمن' : event.actor_user_type === 'technician' ? 'فني' : event.actor_user_type;
                return (
                  <li key={`${event.source}-${event.id}`} className="flex flex-col gap-1 border-r-2 border-muted pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={timelineEventSourceTone(event.source)}>{TIMELINE_SOURCE_LABELS[event.source]}</StatusChip>
                      <span className="text-sm">{event.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(formatDateTimeAr(event.timestamp) ?? '—')}
                      {event.actor_full_name && (
                        <>
                          {' — '}
                          {event.actor_full_name} ({actorTypeLabel})
                        </>
                      )}
                    </p>
                    {typeof reason === 'string' && reason && <p className="text-xs text-muted-foreground">السبب: {reason}</p>}
                    {typeof reasonText === 'string' && reasonText && (
                      <p className="text-xs text-muted-foreground">ملاحظات: {reasonText}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* مفتّش المطابقة (docs/08 §36.5) — واجهة فوق MatchingExplainabilityService الموجود بالفعل
          (§35.7/§35.8)، صفر خوارزمية تشخيصية موازية. فانل الطلب + تفسير فني محدد اختياري. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">مفتّش المطابقة — ليه الطلب ده بيتصرّف كده؟</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/*
            **فشل الفانل مابيوقّعش القسم كله** (بلاغ مالك 2026-09-19).

            كل اللي تحت كان جوّه `{matchingFunnel && …}`، فأي رفض من الـendpoint — وأشهره طلب
            بلا `service_zone_id` — كان بيخفي **جدول جولات التوزيع كمان**، رغم إن الجدول ده
            مصدره endpoint تاني خالص وبيشتغل عادي. الأدمن كان بيشوف رسالة حمرا بس ويستنتج إن
            القسم اتشال. دلوقتي جدول الجولات برّه الشرط، والفانل بيرجّع اللي يقدر عليه.
          */}
          {funnelError && <ErrorNotice className="mb-0">{funnelError}</ErrorNotice>}
          {!funnelError && !matchingFunnel && <p className="text-sm text-muted-foreground">جاري التحميل...</p>}
          {matchingFunnel && (
            <div className="flex flex-col gap-4 text-sm">
              {/* «ليه ده استنى قبول فني وده اتعيّنله على طول؟» — طلبان بنفس وضع الحجز بياخدوا
                  مسارين مختلفين حسب بُعد الموعد، وده كان غير مرئي خالص. النص جاي من الباك-إند
                  (نفس دالة القرار اللي المحرك بيستخدمها) مش متكرّر هنا. */}
              <div>
                <p className="mb-2 font-medium">مسار التوزيع</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={dispatchRouteBadgeClass(matchingFunnel.dispatch_route.route)}>
                    {DISPATCH_ROUTE_LABELS[matchingFunnel.dispatch_route.route]}
                  </Badge>
                  <span className="text-muted-foreground">{matchingFunnel.dispatch_route.explanation_ar}</span>
                </div>
              </div>
              <div>
                <p className="mb-2 font-medium">مجمّع الفنيين المؤهّلين</p>
                {matchingFunnel.pool ? (
                  <div className="flex flex-wrap gap-2">
                    <StatusChip tone="neutral">مؤهّل للفئة: {matchingFunnel.pool.category_eligible}</StatusChip>
                    <StatusChip tone="neutral">مؤهّل للنطاق: {matchingFunnel.pool.zone_eligible}</StatusChip>
                    <Badge variant="outline" className={capacityTierBadgeClass('LIGHT')}>
                      {CAPACITY_TIER_LABELS.LIGHT}: {matchingFunnel.pool.light}
                    </Badge>
                    <Badge variant="outline" className={capacityTierBadgeClass('MEANINGFUL')}>
                      {CAPACITY_TIER_LABELS.MEANINGFUL}: {matchingFunnel.pool.meaningful}
                    </Badge>
                    <Badge variant="outline" className={capacityTierBadgeClass('HEAVY')}>
                      {CAPACITY_TIER_LABELS.HEAVY}: {matchingFunnel.pool.heavy}
                    </Badge>
                    <Badge variant="outline" className={capacityTierBadgeClass('BLOCKED')}>
                      {CAPACITY_TIER_LABELS.BLOCKED}: {matchingFunnel.pool.blocked}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    {matchingFunnel.pool_unavailable_reason_ar ?? 'المجمّع مش متاح لهذا الطلب.'}
                  </p>
                )}
              </div>
              <div>
                {/*
                  **العدّادات بتتعرض كاملة دايمًا — حتى لو أصفار** (بلاغ مالك 2026-09-18).

                  في جولة تنظيم الواجهة (§158) خفّيت الأصفار بحجّة إنها «سطر مالوش معلومة».
                  ده كان غلط: صفر **معلومة حقيقية** («الطلب ده مااتبعتلوش حد» ≠ «القسم مش
                  موجود»)، وإخفاؤه خلّى القسم يبان كأنه اتشال. المالك قال صراحةً إنه ما طلبش
                  إخفاء أي حاجة — فرجعت زي ما كانت بالحرف، واسم الجدول فضل مشال لأنه مصطلح
                  داخلي مش معلومة تشغيلية.
                */}
                <p className="mb-2 font-medium">العروض المبعوتة للفنيين</p>
                <p className="text-muted-foreground">
                  اتبعت: {matchingFunnel.dispatch_assignments.sent} · اتشاف: {matchingFunnel.dispatch_assignments.viewed} · قُبل:{' '}
                  {matchingFunnel.dispatch_assignments.accepted} · رُفض: {matchingFunnel.dispatch_assignments.rejected} · انتهت مهلته:{' '}
                  {matchingFunnel.dispatch_assignments.timeout} · اتلغى: {matchingFunnel.dispatch_assignments.cancelled}
                </p>
              </div>
              {/* القسمين دول كانوا بيختفوا خالص لأي طلب فردي — نفس نمط «الاختفاء الصامت» اللي
                  خلّى المالك يفتكر إن الميزة اتشالت. دلوقتي الغياب نفسه بيتشرح بسببه. */}
              <div>
                <p className="mb-2 font-medium">فرص تجنيد الفريق</p>
                {matchingFunnel.crew_recruit_opportunities ? (
                  <p className="text-muted-foreground">
                    اتعرضت: {matchingFunnel.crew_recruit_opportunities.offered} · اتقبلت: {matchingFunnel.crew_recruit_opportunities.accepted} ·
                    اتراضت: {matchingFunnel.crew_recruit_opportunities.declined} · اتقفلت: {matchingFunnel.crew_recruit_opportunities.closed}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{matchingFunnel.crew_unavailable_reason_ar ?? 'مش منطبق على الطلب ده.'}</p>
                )}
              </div>
              <div>
                <p className="mb-2 font-medium">حالة الطاقم</p>
                {matchingFunnel.crew_status ? (
                  <p className="text-muted-foreground">
                    فنيين: {matchingFunnel.crew_status.assignedTechnicians}/{matchingFunnel.crew_status.requiredTechnicians} · مساعدين:{' '}
                    {matchingFunnel.crew_status.assignedAssistants}/{matchingFunnel.crew_status.requiredAssistants} —{' '}
                    <span className={matchingFunnel.crew_status.crewComplete ? 'text-success' : 'text-warning'}>
                      {matchingFunnel.crew_status.crewComplete ? 'الطاقم مكتمل' : 'الطاقم ناقص'}
                    </span>
                  </p>
                ) : (
                  <p className="text-muted-foreground">{matchingFunnel.crew_unavailable_reason_ar ?? 'مش منطبق على الطلب ده.'}</p>
                )}
              </div>
            </div>
          )}

          {/*
            **جولات التوزيع برّه شرط الفانل** — مصدرها endpoint تاني خالص
            (`/admin/operations/order-traces/:id`) وبتشتغل حتى لما الفانل يرفض. ودي بالظبط
            الحتة اللي المالك بيسأل عنها: «الطلب ده اتبعت لمين، ومين رفضه، وهيتبعت تاني إمتى».
          */}
          <div className="border-t pt-4">
            <p className="mb-1 text-sm font-medium">جولات التوزيع — اتبعت لمين وإمتى</p>
            <OrderTraceRounds
              trace={orderTrace}
              error={traceError}
              order={order}
              dispatchRoute={matchingFunnel?.dispatch_route.route ?? null}
            />
          </div>

          <div className="border-t pt-4">
            <p className="mb-1 font-medium text-sm">ليه/ليه لأ فني أو مساعد محدد؟</p>
            {/* docs/08 §107 — القايمة دي عمدًا مش مفلترة بالأهلية: غير المؤهّل هو بالظبط اللي
                الأدمن محتاج يعرف سبب استبعاده. الـchecks تحت بتقول السبب بالنص.
                §167 — والنص جاي من الباك-إند دلوقتي، لأن نطاق القايمة نفسه بيتغيّر حسب الطلب
                (طلب بلا نطاق خدمة مالوش مجمّع مدينة أصلاً). نص ثابت هنا كان هيكذب على الأدمن. */}
            <p className="mb-2 text-xs text-muted-foreground">
              {candidatesScopeNote ??
                'القايمة بتشمل اللي له علاقة بالطلب ده + المعتمدين في مدينة الطلب — حتى غير المؤهّلين، عشان تعرف سبب استبعاد كل واحد.'}
            </p>
            <form onSubmit={handleExplainTechnician} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="explain_technician" className="text-xs text-muted-foreground">
                  الفني/المساعد
                </Label>
                <SelectNative
                  id="explain_technician"
                  value={explainTechnicianId}
                  onFocus={() => {
                    if (!explainCandidates) loadExplainCandidates();
                  }}
                  onChange={(e) => setExplainTechnicianId(e.target.value)}
                  className="min-w-[280px]"
                >
                  <option value="">اختار فني أو مساعد</option>
                  {/* التجميع بقى بـ**العلاقة بالطلب** مش بالدور (docs/08 §167): الأدمن بيفتح
                      القايمة دي وهو بيسأل عن شخص بعينه على الطلب، فلازم يلاقيه فوق خالص بدل ما
                      يدوّر عليه وسط مجمّع المدينة — ولو مش في المجمّع أصلاً، يفضل موجود. */}
                  {EXPLAIN_RELATION_GROUPS.map(({ relation, label }) => {
                    const group = explainCandidates?.filter((c) => c.relationToOrder === relation) ?? [];
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={relation} label={label}>
                        {group.map((candidate) => (
                          <option key={candidate.technicianId} value={candidate.technicianId}>
                            {technicianKindOptionPrefix(candidate.technicianKind)} {candidate.fullName}
                            {candidate.isEligibleNow ? '' : ' — مش مؤهّل دلوقتي'}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </SelectNative>
              </div>
              <Button type="submit" size="sm" disabled={!explainTechnicianId || explainLoading}>
                {explainLoading ? 'جاري التفسير...' : 'فسّر'}
              </Button>
            </form>
            {candidatesError && <ErrorNotice className="mb-0 mt-2">{candidatesError}</ErrorNotice>}
            {!candidatesError && explainCandidates?.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                مفيش ولا فني أو مساعد له علاقة بالطلب ده، ومفيش معتمدين في مدينته — مش عطل في الشاشة.
              </p>
            )}
            {explainError && <ErrorNotice className="mb-0">{explainError}</ErrorNotice>}
            {explanation && (
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {(() => {
                  const subject = explainCandidates?.find((c) => c.technicianId === explanation.technician_id);
                  if (!subject) return null;
                  return (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <TechnicianKindTag kind={subject.technicianKind} />
                      <span>{subject.fullName}</span>
                      {subject.currentLevel && (
                        <Badge variant="outline">{LEVEL_LABELS[subject.currentLevel as keyof typeof LEVEL_LABELS] ?? subject.currentLevel}</Badge>
                      )}
                    </p>
                  );
                })()}
                <p className="font-medium">
                  <span className={explanation.eligible ? 'text-success' : 'text-destructive'}>
                    {explanation.eligible ? 'مؤهّل' : 'مش مؤهّل'}
                  </span>
                  {' — '}
                  {explanation.reason_ar}
                </p>
                {explanation.capacity_tier && (
                  <p>
                    القدرة الاستيعابية:{' '}
                    <Badge variant="outline" className={capacityTierBadgeClass(explanation.capacity_tier)}>
                      {CAPACITY_TIER_LABELS[explanation.capacity_tier]}
                    </Badge>
                  </p>
                )}
                {explanation.distance_km && <p>المسافة: {Number(explanation.distance_km).toFixed(1)} كم</p>}
                {explanation.rank_info && (
                  <>
                    <p>
                      الترتيب بين المؤهّلين فعليًا: <span className="font-medium">{explanation.rank_info.rank}</span> من أصل{' '}
                      {explanation.rank_info.total_eligible} (rank_score: {explanation.rank_info.rank_score.toFixed(1)})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      جودة {explanation.rank_info.score_breakdown.priority_component.toFixed(1)} − قدرة{' '}
                      {explanation.rank_info.score_breakdown.workload_penalty.toFixed(1)} − عدالة{' '}
                      {explanation.rank_info.score_breakdown.fairness_penalty.toFixed(1)} + موثوقية{' '}
                      {explanation.rank_info.score_breakdown.reliability_adjustment.toFixed(2)} + شركة{' '}
                      {explanation.rank_info.score_breakdown.company_adjustment.toFixed(1)} − مسافة{' '}
                      {explanation.rank_info.score_breakdown.distance_penalty.toFixed(2)}
                      {explanation.rank_info.score_breakdown.distance_weight > 0 && (
                        <span className="text-muted-foreground">
                          {' '}(وزن {explanation.rank_info.score_breakdown.distance_weight} —{' '}
                          {explanation.rank_info.score_breakdown.distance_weight_context_ar})
                        </span>
                      )}
                    </p>
                  </>
                )}
                {!explanation.rank_info && (
                  <p className="text-xs text-muted-foreground">مش ضمن المجمّع المؤهّل فعليًا دلوقتي — راجع الـchecks تحت.</p>
                )}
                <ul className="flex flex-col gap-1">
                  {explanation.checks.map((check) => (
                    <li key={check.key} className="flex items-center gap-2">
                      <span className={check.passed ? 'text-success' : 'text-destructive'}>{check.passed ? '✓' : '✗'}</span>
                      <span className={check.passed ? undefined : 'text-destructive'}>{check.label_ar}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
