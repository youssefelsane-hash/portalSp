'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type {
  AdminTechnicianResponseDto,
  ComplaintResponseDto,
  OrderDetailResponseDto,
  OrderEarningShareResponseDto,
  OrderFinancialSummaryResponseDto,
  OrderItemResponseDto,
  OrderMatchingFunnelDto,
  OrderMediaResponseDto,
  OrderTimelineEventResponseDto,
  RemoveCrewMemberResponseDto,
  TeamMemberResponseDto,
  TechnicianCapacityTier,
  TechnicianEligibilityExplanationDto,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
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

// GET /technicians/:id/schedule (نسخة العميل — is_available بس، docs/08 §25.2 فتحها للأدمن كمان)
interface ScheduleSlot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

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
  isOrderReschedulable,
  TIMELINE_SOURCE_LABELS,
  timelineEventSourceTone,
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
import { formatEgp } from '@/lib/format';

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

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch, authedFetchPaginated, hasPermission } = useAuth();
  // رجوع حقيقي بيحافظ على حالة القايمة (docs/08 §63.ب6) بدل router.push اللي كان بيضيّعها.
  const goBack = useAdminBack('/orders');

  const [order, setOrder] = useState<OrderDetailResponseDto | null>(null);
  const [financialSummary, setFinancialSummary] = useState<OrderFinancialSummaryResponseDto | null>(null);
  const [earningShares, setEarningShares] = useState<OrderEarningShareResponseDto[] | null>(null);
  const [earningSharesError, setEarningSharesError] = useState(false);
  const [media, setMedia] = useState<OrderMediaResponseDto[]>([]);
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
    }[] | null
  >(null);
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
  // إعادة جدولة زيارة فاشلة (docs/08 §25.2) — لازم موعد جديد فعلي بيتحقق من availability الفني،
  // مش زرار بيرجّع الطلب ACCEPTED بنفس الموعد القديم بصمت.
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<ScheduleSlot[] | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');
  const [showCashDisputeConfirmForm, setShowCashDisputeConfirmForm] = useState(false);
  const [cashDisputeNotes, setCashDisputeNotes] = useState('');
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmountEgp, setRefundAmountEgp] = useState('');
  const [refundReason, setRefundReason] = useState('');
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
  const [adminRescheduleReason, setAdminRescheduleReason] = useState('');
  // مفتّش المطابقة (docs/08 §36.5) — واجهة فوق MatchingExplainabilityService الموجود بالفعل
  // (§35.7/§35.8)، صفر خوارزمية تشخيصية موازية. funnelError متوقّع/هادئ لطلبات بلا service_zone_id
  // (400 من الباك-إند نفسه — مش كل الطلبات القديمة عندها نطاق محدد).
  const [matchingFunnel, setMatchingFunnel] = useState<OrderMatchingFunnelDto | null>(null);
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
    authedFetch<OrderItemResponseDto[]>(`/admin/orders/${id}/quote-items`)
      .then(setQuoteItems)
      .catch(() => setQuoteItems([]));
    authedFetch<AdminOrderQuote[]>(`/admin/orders/${id}/quotes`)
      .then(setQuotes)
      .catch(() => setQuotes([]));
    // الملخص المالي (docs/08 §20 بند 11) — مسار منفصل عمداً زي الصور وبنود العرض فوق
    authedFetch<OrderFinancialSummaryResponseDto>(`/admin/orders/${id}/financial-summary`)
      .then(setFinancialSummary)
      .catch(() => setFinancialSummary(null));
    // توزيع أرباح الطاقم إداري فقط. فشل المسار لا يمنع عرض الملخص المالي أو باقي الطلب.
    setEarningSharesError(false);
    authedFetch<OrderEarningShareResponseDto[]>(`/admin/orders/${id}/earning-shares`)
      .then(setEarningShares)
      .catch(() => {
        setEarningShares([]);
        setEarningSharesError(true);
      });
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

  useAdminLiveRefresh(['orders', 'payments'], (event) => {
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
      }[];
    }>(`/admin/orders/${id}/explain-candidates`)
      .then(({ items }) =>
        setExplainCandidates(
          items.map((item) => ({
            technicianId: item.technician_id,
            fullName: item.full_name,
            technicianKind: item.technician_kind,
            currentLevel: item.current_level,
            isEligibleNow: item.is_eligible_now,
          })),
        ),
      )
      .catch(() => setExplainCandidates([]));
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
    setIsSaving(true);
    setError(null);
    try {
      await authedFetch(`/admin/orders/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason_notes: refundReason, ...(amountCents !== undefined ? { amount_cents: amountCents } : {}) }),
      });
      setShowRefundForm(false);
      setRefundAmountEgp('');
      setRefundReason('');
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
  // بَقّة حقيقية اتصلحت (§25.2، قرار مالك صريح 2026-08-15): الزرار كان بيبعت request فوري يرجّع
  // الطلب ACCEPTED بنفس الموعد القديم بالظبط، صفر اختيار موعد جديد وصفر فحص availability —
  // بالظبط زي ما الباك-إند كان بيقبله قبل الإصلاح. دلوقتي بيفتح فورم بيجيب سلوتات الفني المتاحة
  // فعليًا (GET /technicians/:id/schedule، نفس الـendpoint اللي العميل بيستخدمه وقت الحجز الأصلي).
  async function handleOpenRescheduleForm() {
    setShowRescheduleForm((s) => !s);
    if (availableSlots !== null || !order?.technician_id) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const slots = await authedFetch<ScheduleSlot[]>(
        `/technicians/${order.technician_id}/schedule?from=${today}&to=${to}`,
      );
      setAvailableSlots(slots.filter((s) => s.is_available));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل جدول الفني');
    }
  }

  async function handleResolveFailedVisitReschedule(e: FormEvent) {
    e.preventDefault();
    if (!selectedSlotId) {
      window.alert('لازم تختار موعد جديد من الجدول');
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
        body: JSON.stringify({ outcome: 'reschedule', admin_notes: rescheduleNotes, new_slot_id: selectedSlotId }),
      });
      setShowRescheduleForm(false);
      setAvailableSlots(null);
      setSelectedSlotId('');
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

      {error && <p className="mb-4 text-destructive">{error}</p>}

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

      {/* Timeline موحّد (Script 4 Part G §30-32) — جنب كروت "تاريخ الحالة"/"إلغاءات الفني"
          المتخصصة تحت، مش بديل عنهم. القيمة المضافة: بيورّي audit_log وorder_assignments كمان
          (مفيش كارت كان بيعرضهم في صفحة الطلب أصلاً) في نفس التسلسل الزمني. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Timeline — كل الأحداث بترتيب زمني ({timeline.length})</CardTitle>
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
                      {new Date(event.timestamp).toLocaleString('ar-EG-u-nu-latn')}
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
          {funnelError && <p className="text-sm text-destructive">{funnelError}</p>}
          {!funnelError && !matchingFunnel && <p className="text-sm text-muted-foreground">جاري التحميل...</p>}
          {matchingFunnel && (
            <div className="flex flex-col gap-4 text-sm">
              <div>
                <p className="mb-2 font-medium">مجمّع الفنيين المؤهّلين</p>
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
              </div>
              <div>
                <p className="mb-2 font-medium">توزيع الطلب (order_assignments)</p>
                <p className="text-muted-foreground">
                  اتبعت: {matchingFunnel.dispatch_assignments.sent} · اتشاف: {matchingFunnel.dispatch_assignments.viewed} · قُبل:{' '}
                  {matchingFunnel.dispatch_assignments.accepted} · رُفض: {matchingFunnel.dispatch_assignments.rejected} · انتهت مهلته:{' '}
                  {matchingFunnel.dispatch_assignments.timeout} · اتلغى: {matchingFunnel.dispatch_assignments.cancelled}
                </p>
              </div>
              {matchingFunnel.crew_recruit_opportunities && (
                <div>
                  <p className="mb-2 font-medium">فرص تجنيد الفريق</p>
                  <p className="text-muted-foreground">
                    اتعرضت: {matchingFunnel.crew_recruit_opportunities.offered} · اتقبلت: {matchingFunnel.crew_recruit_opportunities.accepted} ·
                    اتراضت: {matchingFunnel.crew_recruit_opportunities.declined} · اتقفلت: {matchingFunnel.crew_recruit_opportunities.closed}
                  </p>
                </div>
              )}
              {matchingFunnel.crew_status && (
                <div>
                  <p className="mb-2 font-medium">حالة الطاقم</p>
                  <p className="text-muted-foreground">
                    فنيين: {matchingFunnel.crew_status.assignedTechnicians}/{matchingFunnel.crew_status.requiredTechnicians} · مساعدين:{' '}
                    {matchingFunnel.crew_status.assignedAssistants}/{matchingFunnel.crew_status.requiredAssistants} —{' '}
                    <span className={matchingFunnel.crew_status.crewComplete ? 'text-success' : 'text-warning'}>
                      {matchingFunnel.crew_status.crewComplete ? 'الطاقم مكتمل' : 'الطاقم ناقص'}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4">
            <p className="mb-1 font-medium text-sm">ليه/ليه لأ فني أو مساعد محدد؟</p>
            {/* docs/08 §107 — القايمة دي عمدًا مش مفلترة بالأهلية: غير المؤهّل هو بالظبط اللي
                الأدمن محتاج يعرف سبب استبعاده. الـchecks تحت بتقول السبب بالنص. */}
            <p className="mb-2 text-xs text-muted-foreground">
              القايمة بتشمل الفنيين والمساعدين المعتمدين في مدينة الطلب — حتى غير المؤهّلين، عشان تعرف سبب استبعاد كل واحد.
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
                  {(['technician', 'assistant'] as TechnicianKindCode[]).map((kind) => {
                    const group = explainCandidates?.filter((c) => c.technicianKind === kind) ?? [];
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={kind} label={kind === 'technician' ? 'فنيين' : 'مساعدين'}>
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
            {explainError && <p className="mt-2 text-sm text-destructive">{explainError}</p>}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">البيانات</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {/* اسم الخدمة — كان غايب تمامًا (docs/08 §73 بند 3)، موظف مركز الاتصال محتاج يعرف
                الطلب ده على إيه بالظبط من أول نظرة، مش يستنتج من السعر/الوصف بس. */}
            {order.service_name_ar && <p>الخدمة: {order.service_name_ar}</p>}
            <p>نوع الطلب: {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</p>
            <p>وضع الحجز: {BOOKING_MODE_LABELS[order.booking_mode] ?? order.booking_mode}</p>
            <p>الإجمالي: {formatEgp(order.total_amount_cents)}</p>
            <p className="flex items-center gap-2">
              حالة الدفع:
              <StatusChip tone={paymentStatusTone(order.payment_status)}>
                {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
              </StatusChip>
            </p>
            <p>رسوم الكشف: {formatEgp(order.inspection_fee_cents)}</p>
            {order.surge_amount_cents > 0 && (
              <p className="text-destructive">رسوم الطوارئ: {formatEgp(order.surge_amount_cents)}</p>
            )}
            {order.discount_amount_cents > 0 && <p>الخصم: {formatEgp(order.discount_amount_cents)}</p>}
            {/* اسم/تليفون الفني بدل الـUUID الخام (طلب مالك صريح — موظف العمليات مش المفروض ينسخ
                UUID يدويًا عشان يعرف مين الفني). الـUUID لسه موجود كمعلومة ثانوية (title) لو
                احتاجه حد للتصحيح التقني. الاسم قابل للنقر — بيودّي لصفحة بروفايل الفني. */}
            <p>
              الفني:{' '}
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
                'لسه مفيش'
              )}
            </p>
            {order.problem_description && <p>وصف المشكلة: {order.problem_description}</p>}
            {/* docs/08 §71 — اللي العميل اختاره في الفورم الديناميكي وقت الحجز، سطر واحد. */}
            {order.customer_inputs && order.customer_inputs.length > 0 && (
              <p className="whitespace-normal">
                اختيارات العميل:{' '}
                {order.customer_inputs
                  .map((input) => `${input.label}: ${input.value}${input.unit ? ` ${input.unit}` : ''}`)
                  .join(' · ')}
              </p>
            )}
            {order.customer_notes && <p>ملاحظات العميل: {order.customer_notes}</p>}
            <p>
              اتحجز في: {order.placed_at ? new Date(order.placed_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
            </p>
            {/* موعد الخدمة المطلوب — مختلف تمامًا عن "اتحجز في" (وقت إنشاء الطلب). طلب مالك صريح:
                موظفي العمليات كانوا بيلخبطوا بين الاتنين. null = "في أقرب وقت ممكن" (ASAP)، مش
                غياب بيانات — نفس دلالة scheduled_at=null في باقي المشروع (ScheduleChoice.asap). */}
            <p className="font-medium">
              موعد الخدمة المطلوب:{' '}
              {order.scheduled_at ? (
                new Date(order.scheduled_at).toLocaleDateString('ar-EG-u-nu-latn', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              ) : (
                <Badge variant="secondary">في أقرب وقت ممكن</Badge>
              )}
            </p>
            {order.warranty_expires_at && (
              <p>
                الضمان لحد: {new Date(order.warranty_expires_at).toLocaleString('ar-EG-u-nu-latn')}
                {new Date(order.warranty_expires_at) > new Date() ? (
                  <Badge variant="secondary" className="mr-2">
                    سارٍ
                  </Badge>
                ) : (
                  <Badge variant="outline" className="mr-2">
                    منتهي
                  </Badge>
                )}
              </p>
            )}
            {order.optional_warranty && (
              <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-blue-900">
                ضمان إضافي: {order.optional_warranty.name_ar} ({order.optional_warranty.coverage_months} شهر)
                {' · '}تكلفته {formatEgp(order.warranty_price_cents)} ضمن إجمالي الطلب
              </p>
            )}
          </CardContent>
          {isOrderCancellable(order.order_status) && (
            <CardFooter className="flex-col items-stretch gap-3">
              <div className="flex gap-2">
                <Button variant="destructive" disabled={isSaving} onClick={() => setShowCancelForm((s) => !s)}>
                  إلغاء الطلب
                </Button>
                {isOrderReassignable(order.order_status) && (
                  <Button
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      setShowReassignForm((s) => !s);
                      if (!eligibleReassignTechnicians) loadEligibleReassignTechnicians();
                    }}
                  >
                    {order.technician_id ? 'استبدال الفني المعيّن' : 'تعيين فني يدوي'}
                  </Button>
                )}
              </div>
              {showCancelForm && (
                <form onSubmit={handleCancel} className="flex flex-col gap-2">
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
                  <Label htmlFor="technician_id">الفني/المساعد الجديد</Label>
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
                        اختار فني أو مساعد
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
                  <Button type="submit" size="sm" disabled={isSaving || !technicianId}>
                    تأكيد إعادة التعيين
                  </Button>
                </form>
              )}
            </CardFooter>
          )}
          {/* إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — مستقلة عن isOrderCancellable
              فوق (accepted مش cancellable لكنها reschedulable). استخدام تشغيلي: العميل يتصل
              يطلب تأجيل الميعاد، الموظف بينفذها نيابة عنه. */}
          {isOrderReschedulable(order.order_status) && hasPermission('orders.reschedule') && (
            <CardFooter className="flex-col items-stretch gap-3">
              <Button type="button" variant="outline" disabled={isSaving} onClick={handleOpenAdminRescheduleForm}>
                إعادة جدولة الموعد
              </Button>
              {showAdminRescheduleForm && (
                <form onSubmit={handleAdminReschedule} className="flex flex-col gap-2">
                  <Label htmlFor="admin_reschedule_date">اليوم الجديد</Label>
                  {adminRescheduleOptions === null && (
                    <p className="text-xs text-muted-foreground">جاري تحميل أيام الفني المتاحة…</p>
                  )}
                  {adminRescheduleOptions !== null && (
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
          {order.payment_status === 'paid' &&
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
                    <div>
                      <Label htmlFor="refund_amount_egp">مبلغ الاسترجاع (جنيه) — اختياري، فاضي = استرجاع كامل</Label>
                      <Input
                        id="refund_amount_egp"
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={refundAmountEgp}
                        onChange={(e) => setRefundAmountEgp(e.target.value)}
                        placeholder={`الكامل: ${(order.total_amount_cents / 100).toFixed(2)} ج.م.`}
                      />
                    </div>
                    <div>
                      <Label htmlFor="refund_reason">سبب الاسترجاع</Label>
                      <Input id="refund_reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} minLength={2} required />
                    </div>
                    <Button type="submit" size="sm" variant="destructive" disabled={isSaving}>
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
                    <Label htmlFor="new_slot_id">الموعد الجديد</Label>
                    {availableSlots === null && <p className="text-xs text-muted-foreground">جاري تحميل جدول الفني…</p>}
                    {availableSlots !== null && availableSlots.length === 0 && (
                      <p className="text-xs text-destructive">مفيش سلوتات متاحة للفني ده حاليًا — لازم يضيف مواعيد فاضية الأول.</p>
                    )}
                    {availableSlots !== null && availableSlots.length > 0 && (
                      <SelectNative
                        id="new_slot_id"
                        value={selectedSlotId}
                        onChange={(e) => setSelectedSlotId(e.target.value)}
                        required
                      >
                        <option value="">اختار موعد</option>
                        {availableSlots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.slot_date} — {slot.start_time.slice(0, 5)} إلى {slot.end_time.slice(0, 5)}
                          </option>
                        ))}
                      </SelectNative>
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
                    disabled={isSaving || !availableSlots || availableSlots.length === 0}
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
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              الاسم:{' '}
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
            </p>
            {order.customer_phone && (
              <p dir="ltr" className="text-start">
                {order.customer_phone}
              </p>
            )}
            {order.address && (
              <p>
                العنوان: {order.address.street_name}
                {order.address.landmark ? ` — ${order.address.landmark}` : ''}
              </p>
            )}
          </CardContent>
        </Card>

        {/* الملخص المالي لكل طلب (docs/08 §20 بند 11) — كارت واحد واضح يجمع كل حاجة متبعثرة قبل
            كده: عمولة/أرباح (كانت محسوبة بس مش معروضة خالص)، وسيلة/حالة كل دفعة، وأي استرداد. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الملخص المالي</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!financialSummary && <p className="text-muted-foreground">جاري التحميل…</p>}
            {financialSummary && (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3">
                  <p>إجمالي الطلب: {formatEgp(financialSummary.total_amount_cents)}</p>
                  <p className="text-success">مدفوع فعليًا: {formatEgp(financialSummary.paid_amount_cents)}</p>
                  {financialSummary.financed_order_amount_cents > 0 && (
                    <p>مغطى بالتقسيط: {formatEgp(financialSummary.financed_order_amount_cents)}</p>
                  )}
                  <p className={financialSummary.amount_due_to_technician_cents > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-success'}>
                    المطلوب من الفني تحصيله: {formatEgp(financialSummary.amount_due_to_technician_cents)}
                  </p>
                  {financialSummary.installment_outstanding_cents > 0 && (
                    <p className="col-span-2 text-xs text-muted-foreground">
                      باقي جدول التقسيط على العميل: {formatEgp(financialSummary.installment_outstanding_cents)} — تحصّله المنصة، وليس الفني.
                    </p>
                  )}
                  {financialSummary.refunded_amount_cents > 0 && (
                    <p className="text-destructive">مسترد فعليًا: {formatEgp(financialSummary.refunded_amount_cents)}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <p>عمولة المنصة: {formatEgp(financialSummary.platform_commission_cents)}</p>
                  <p>أرباح الفني: {formatEgp(financialSummary.technician_earning_cents)}</p>
                  {financialSummary.cancellation_fee_cents > 0 && (
                    <p className="text-destructive">
                      رسوم إلغاء: {formatEgp(financialSummary.cancellation_fee_cents)}
                    </p>
                  )}
                </div>

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
                          {p.payment_status === 'failed' && p.failure_message && (
                            <span className="text-destructive">تعذّر التحصيل: {p.failure_message}</span>
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
                        <li key={r.id} className="flex items-center justify-between border-b pb-1 text-xs last:border-0">
                          <span>
                            {REFUND_METHOD_LABELS[r.refund_method]} · {REFUND_STATUS_LABELS[r.refund_status]}
                          </span>
                          <span className="text-destructive">-{formatEgp(r.amount_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
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
                        <TableCell>{new Date(member.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
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
                          <TableCell>{new Date(member.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
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
                      <TableCell>{new Date(entry.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">الإنتاجية والمدة المتوقعة</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.pricing_evaluation ? (
              <>
                <p>
                  المدة المتوقعة:{' '}
                  {order.pricing_evaluation.computed_duration_days !== null
                    ? `${order.pricing_evaluation.computed_duration_days} يوم`
                    : '—'}
                </p>
                <p>
                  عدد الصنايعية المطلوب:{' '}
                  {order.pricing_evaluation.computed_technicians ?? '—'}
                </p>
                <p>
                  عدد المساعدين المطلوب:{' '}
                  {order.pricing_evaluation.computed_assistants ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  محسوبة وقت الحجز في:{' '}
                  {new Date(order.pricing_evaluation.created_at).toLocaleString('ar-EG-u-nu-latn')}
                </p>
              </>
            ) : order.standard_data_id ? (
              // محرك الإنتاجية (docs/06 §3.3-§3.6) — نفس فكرة pricing_evaluation فوق بس لخدمات
              // مبنية على بيانات قياسية (service_standard_data) مش formula.
              <>
                <p>
                  المدة المتوقعة:{' '}
                  {order.estimated_duration_days !== null ? `${order.estimated_duration_days} يوم` : '—'}
                </p>
                <p>عدد الصنايعية المطلوب: {order.required_technicians ?? '—'}</p>
                <p>عدد المساعدين المطلوب: {order.required_assistants ?? '—'}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                مفيش بيانات إنتاجية محسوبة لهذا الطلب — الخدمة مش بتستخدم معادلة تسعير (pricing_model=formula)
                ولا بيانات قياسية (service_standard_data)
              </p>
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
                      <TableCell>{new Date(c.cancelled_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
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
                      {n.author_full_name ?? 'موظف'} — {new Date(n.created_at).toLocaleString('ar-EG-u-nu-latn')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
