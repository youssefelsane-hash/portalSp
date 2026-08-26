'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AdminTechnicianResponseDto,
  OrderDetailResponseDto,
  OrderFinancialSummaryResponseDto,
  OrderItemResponseDto,
  OrderMatchingFunnelDto,
  OrderMediaResponseDto,
  OrderTimelineEventResponseDto,
  RemoveCrewMemberResponseDto,
  TeamMemberResponseDto,
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
import { CAPACITY_TIER_LABELS, capacityTierBadgeClass } from '@/lib/technician-labels';
import { formatEgp } from '@/lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, authedFetch, authedFetchPaginated, hasPermission } = useAuth();
  const router = useRouter();
  // رجوع حقيقي بيحافظ على حالة القايمة (docs/08 §63.ب6) بدل router.push اللي كان بيضيّعها.
  const goBack = useAdminBack('/orders');

  const [order, setOrder] = useState<OrderDetailResponseDto | null>(null);
  const [financialSummary, setFinancialSummary] = useState<OrderFinancialSummaryResponseDto | null>(null);
  const [media, setMedia] = useState<OrderMediaResponseDto[]>([]);
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
    { technicianId: string; fullName: string }[] | null
  >(null);
  const [showAdjustPriceForm, setShowAdjustPriceForm] = useState(false);
  const [newTotalEgp, setNewTotalEgp] = useState('');
  const [adjustPriceReason, setAdjustPriceReason] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberResponseDto[]>([]);
  const [showAssignAssistantForm, setShowAssignAssistantForm] = useState(false);
  const [assistantTechnicianId, setAssistantTechnicianId] = useState('');
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
    // الملخص المالي (docs/08 §20 بند 11) — مسار منفصل عمداً زي الصور وبنود العرض فوق
    authedFetch<OrderFinancialSummaryResponseDto>(`/admin/orders/${id}/financial-summary`)
      .then(setFinancialSummary)
      .catch(() => setFinancialSummary(null));
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

  function loadEligibleReassignTechnicians() {
    authedFetch<{ zoneId: string; items: { technicianId: string; fullName: string }[] }>(
      `/admin/orders/${id}/eligible-technicians`,
    )
      .then(({ items }) => setEligibleReassignTechnicians(items))
      .catch(() => setEligibleReassignTechnicians([]));
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
    try {
      await authedFetch(`/admin/orders/${id}/assistants`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: assistantTechnicianId }),
      });
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
    try {
      await authedFetch(`/admin/orders/${id}/team-members`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: crewTechnicianId, role_label: crewRoleLabel }),
      });
      setShowAddCrewForm(false);
      setCrewTechnicianId('');
      setCrewRoleLabel('');
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
  const crewMembers = teamMembers.filter((m) => m.member_type !== 'assistant');

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
            <p className="mb-2 font-medium text-sm">ليه/ليه لأ فني محدد؟</p>
            <form onSubmit={handleExplainTechnician} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="explain_technician" className="text-xs text-muted-foreground">
                  الفني
                </Label>
                <SelectNative
                  id="explain_technician"
                  value={explainTechnicianId}
                  onFocus={() => {
                    if (!eligibleReassignTechnicians) loadEligibleReassignTechnicians();
                  }}
                  onChange={(e) => setExplainTechnicianId(e.target.value)}
                  className="min-w-[220px]"
                >
                  <option value="">اختار فني</option>
                  {eligibleReassignTechnicians?.map((tech) => (
                    <option key={tech.technicianId} value={tech.technicianId}>
                      {tech.fullName}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <Button type="submit" size="sm" disabled={!explainTechnicianId || explainLoading}>
                {explainLoading ? 'جاري التفسير...' : 'فسّر'}
              </Button>
            </form>
            {explainError && <p className="mt-2 text-sm text-destructive">{explainError}</p>}
            {explanation && (
              <div className="mt-3 flex flex-col gap-2 text-sm">
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
                      {explanation.rank_info.score_breakdown.company_adjustment.toFixed(1)}
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
                  <Label htmlFor="technician_id">الفني الجديد</Label>
                  {!eligibleReassignTechnicians ? (
                    <p className="text-sm text-muted-foreground">جاري تحميل الفنيين المؤهلين لهذا الطلب…</p>
                  ) : eligibleReassignTechnicians.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      مفيش فنيين مؤهلين ومتاحين لخدمة/منطقة/موعد الطلب ده دلوقتي
                    </p>
                  ) : (
                    <SelectNative
                      id="technician_id"
                      value={technicianId}
                      onChange={(e) => setTechnicianId(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        اختار فني
                      </option>
                      {eligibleReassignTechnicians.map((tech) => (
                        <option key={tech.technicianId} value={tech.technicianId}>
                          {tech.fullName}
                        </option>
                      ))}
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

        {/* تعيين مساعد يدوي بعد التصعيد (ADR-0008) — بيظهر بس لو الطلب أصلاً محتاج مساعدين. */}
        {!!order.required_assistants && order.required_assistants > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المساعدين ({teamMembers.length}/{order.required_assistants})</CardTitle>
            </CardHeader>
            <CardContent>
              {teamMembers.length === 0 ? (
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
                    {teamMembers.map((member) => (
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
            {teamMembers.length < order.required_assistants && (
              <CardFooter className="flex-col items-stretch gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  className="w-fit"
                  onClick={() => {
                    setShowAssignAssistantForm((s) => !s);
                    if (!approvedTechnicians) loadApprovedTechnicians();
                  }}
                >
                  عيّن مساعد يدويًا
                </Button>
                {showAssignAssistantForm && (
                  <form onSubmit={handleAssignAssistant} className="flex flex-col gap-2">
                    <Label htmlFor="assistant_technician_id">الفني</Label>
                    {!approvedTechnicians ? (
                      <p className="text-sm text-muted-foreground">بيحمّل قايمة الفنيين…</p>
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
                        {approvedTechnicians.map((tech) => (
                          <option key={tech.id} value={tech.id}>
                            {tech.full_name} ({tech.technician_code})
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
                            <TableCell colSpan={4}>
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
                            <TableCell colSpan={4}>
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
          <CardHeader>
            <CardTitle className="text-base">صور الطلب</CardTitle>
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
      </div>
    </AppShell>
  );
}
