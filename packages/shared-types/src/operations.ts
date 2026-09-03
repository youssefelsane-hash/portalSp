import type { TechnicianCapacityTier, TechnicianLevel } from './technicians';

// مطابق لـ apps/api/src/modules/operations/admin-operations.controller.ts (docs/08 §36.2 —
// بداية "مركز العمليات" الجديد، هيتوسّع مرحلة بمرحلة حسب §36.3-14).
export interface OperationsOverview {
  dispatch_pending_count: number;
  crew_shortage_open_count: number;
  technicians_online_count: number;
  capacity_today: { light: number; meaningful: number; heavy: number; blocked: number };
}

// عرض الحمل القريب — 7 أيام (docs/08 §36.4، GET /admin/operations/workload-forecast). نفس تصنيف
// TechnicianCapacityTier (LIGHT/MEANINGFUL/HEAVY/BLOCKED) من technicians.ts لكل يوم — صفر تصنيف
// موازي جديد. is_multi_day علامة بصرية بس (يوم بداية شغلانة متوقّع تاخد يومين فأكتر)، مش ادّعاء
// إن الأيام التالية محجوزة فعليًا في محرك المطابقة الحالي — راجع تعليق admin-workload-forecast
// .service.ts للتفصيل الكامل.
export interface WorkloadForecastDayDto {
  date: string;
  tier: TechnicianCapacityTier;
  is_multi_day: boolean;
}

export interface WorkloadForecastRowDto {
  id: string;
  technician_code: string;
  full_name: string;
  current_level: TechnicianLevel;
  days: WorkloadForecastDayDto[];
}

// مراقبة تسليم الطلبات — REQ SENT + حالات حقيقية بس (docs/08 §36.7،
// GET /admin/operations/dispatch-delivery). بيجمع مصدرين حقيقيين موجودين بالفعل: order_assignments
// (البث المباشر/الطوارئ لكل جولة) وtechnician_work_opportunities (فرص الشغل الإضافي الاختياري/
// تجنيد الفريق) — صفر حالة توصيل مخترعة، صفر طبقة تتبّع موازية جديدة.
export interface DispatchAssignmentStatusCountsDto {
  sent: number;
  viewed: number;
  accepted: number;
  rejected: number;
  timeout: number;
  cancelled: number;
  // صفوف لسه 'sent' بعد ما فات معادها (expires_at حقيقي) — استنتاج مباشر، مش حالة مخترعة.
  stale_sent_count: number;
}

export interface DispatchWorkOpportunityStatusCountsDto {
  offered: number;
  accepted: number;
  declined: number;
  closed: number;
}

export interface DispatchDeliverySummaryDto {
  assignments: DispatchAssignmentStatusCountsDto;
  work_opportunities: DispatchWorkOpportunityStatusCountsDto;
}

export type DispatchDeliveryKind = 'assignment' | 'work_opportunity';

export interface DispatchDeliveryItemDto {
  id: string;
  kind: DispatchDeliveryKind;
  order_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  // بس لـkind='work_opportunity' ('assignment' | 'crew_recruit') — null لـkind='assignment'.
  context: string | null;
  sent_at: string;
  /** إمتى الفني فتح العرض فعلاً (order_assignments.viewed_at، migration 0255). null لـwork_opportunity. */
  viewed_at: string | null;
  responded_at: string | null;
  // بس لـkind='assignment' (order_assignments عنده expires_at حقيقي) — دايمًا null لـwork_opportunity.
  // **مهلة توسيع الجولة**، مش انتهاء صلاحية العرض: العرض بيفضل قابل للقبول بعدها لحد ما فني تاني
  // ياخد الطلب أو الفني ده يرفض صراحة (matching-round-expiry.processor.ts).
  expires_at: string | null;
  /** جولة المطابقة اللي العرض ده اتبعت فيها. null لـwork_opportunity (مالهاش جولات). */
  assignment_round: number | null;
  is_stale: boolean;
  order_number: string;
  // كام فني مختلف الطلب اتبعتله إجماليًا (كل الجولات + فرص الشغل، بلا قيد نافذة التبويب الزمنية).
  order_technician_count: number;
}

// ملحوظة تسمية مقصودة: items/meta متعشّشين تحت feed مش على المستوى الأول جنب summary — لو كانوا
// على نفس مستوى summary، ResponseInterceptor في الباك-إند بيعمل auto-unwrap تلقائي لأي رد فيه
// items+meta (بيفحص وجودهم بس، مش الحصرية) ويقطع summary بصمت تام. راجع تعليق
// admin-dispatch-delivery.service.ts للتفصيل الكامل — بَقّة حقيقية اتلقطت بـcurl حي.
export interface DispatchDeliveryResponseDto {
  summary: DispatchDeliverySummaryDto;
  feed: { items: DispatchDeliveryItemDto[]; meta: { page: number; perPage: number; total: number } };
}

// مركز الاستثناءات/التنبيهات (docs/08 §36.9، GET /admin/operations/exceptions) — "فوق تصعيد §35.4
// + تنبيهات جديدة". قايمة "محتاج تصرّف دلوقتي" محدودة (لمحة، مش جدول قابل للتصفح) — راجع تعليق
// admin-exception-center.service.ts للتفصيل الكامل. صفر نوع استثناء بعتبة وقت مخترعة.
export interface CrewShortageExceptionItemDto {
  order_id: string;
  order_number: string;
  scheduled_at: string;
  escalated_at: string;
  missing_technicians: number;
  missing_assistants: number;
  is_overdue: boolean;
}

export interface StaleDispatchExceptionItemDto {
  assignment_id: string;
  order_id: string;
  /** رقم الطلب المقروء (docs/08 §77-A3) — الصف كان بيعرض الفني والميعاد بلا هوية الطلب. */
  order_number: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  sent_at: string;
  expires_at: string;
}

/** شغلانة معادها عدّى ولسه الفني ما بدأش — أعجل بند في المركز (docs/08 §56 بند 4). */
export interface OverdueOrderExceptionItemDto {
  order_id: string;
  order_number: string;
  scheduled_at: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  days_late: number;
}

/**
 * إعادة زيارة مثبّتة على فني مبقاش عنده الطلب (ADR-0051، docs/08 §96) — الأدمن هو اللي بيحرّرها
 * بـ`POST /admin/orders/:id/release-revisit` (قرار مالي: خصم نصيب الفني من الطلب الأصلي).
 */
export interface StalledRevisitExceptionItemDto {
  order_id: string;
  order_number: string;
  original_order_id: string | null;
  original_order_number: string | null;
  technician_id: string;
  technician_code: string;
  full_name: string;
  phone: string | null;
  pinned_at: string;
  deadline_at: string;
  reason: string;
  /** نصيب الفني من الطلب الأصلي — ده بالظبط اللي هيتخصم لو الأدمن حرّر. */
  chargeback_cents: number;
}

/**
 * **المطابقة نفسها اتأخرت** — مش الفني.
 *
 * مختلف عمدًا عن `stale_dispatch`: ده بيقول «عرض فات معاده بلا رد» (سلوك فني طبيعي)، وده بيقول
 * «مهلة الجولة عدّت والمحرك ما فتحش الجولة اللي بعدها» (عطل في الـworkflow). خلطهم كان هيخفي
 * أخطر الاتنين.
 */
export interface MatchingWorkflowDelayedItemDto {
  order_id: string;
  order_number: string;
  current_round: number;
  max_rounds: number;
  expected_expansion_at: string;
  delay_seconds: number;
  technicians_contacted: number;
}

export interface ExceptionCenterResponseDto {
  overdue_orders: { items: OverdueOrderExceptionItemDto[]; total: number };
  crew_shortage: { items: CrewShortageExceptionItemDto[]; total: number };
  stale_dispatch: { items: StaleDispatchExceptionItemDto[]; total: number };
  stalled_revisits: { items: StalledRevisitExceptionItemDto[]; total: number };
  matching_workflow_delayed: { items: MatchingWorkflowDelayedItemDto[]; total: number };
}

// ذكاء تغطية القوى العاملة — فئة+منطقة (docs/08 §36.10، GET /admin/operations/coverage). صف لكل
// زوج (منطقة، فئة) بيجمع العرض (فنيين LIGHT/MEANINGFUL متاحين النهاردة) والطلب (طلبات لسه بتدوّر) —
// راجع تعليق admin-coverage-intelligence.service.ts للتفصيل الكامل. zoneId عنده فنيين صفر ولسه فيه
// طلبات بتدوّر بيظهر برضه (أخطر حالة تغطية)، مش بس الأزواج اللي فيها فنيين مسجّلين بالفعل.
export type CoverageStatusDto = 'critical' | 'tight' | 'healthy';

export interface CoverageRowDto {
  zone_id: string;
  zone_name: string;
  category_id: string;
  category_name: string;
  technicians_total: number;
  technicians_light: number;
  technicians_meaningful: number;
  technicians_heavy: number;
  technicians_blocked: number;
  dispatch_pending_count: number;
  coverage_status: CoverageStatusDto;
}

// تتبّع الطلب في المطابقة (GET /admin/operations/order-traces) — نفس `order_assignments` اللي
// بيغذّي dispatch-delivery، بس مجمّع حسب الطلب → الجولة → الفني بدل feed مسطّح زمني. الـfeed
// بيجاوب «إيه اللي حصل»، وده بيجاوب «الطلب ده وصل لمين ومستني إيه دلوقتي». مفيش محرك مطابقة
// تاني هنا: صفر قرار أهلية/ترتيب/جدولة — قراءة وتجميع بس.
export interface OrderTraceTechnicianDto {
  assignment_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  sent_at: string;
  /** إمتى الفني فتح العرض فعلاً (order_assignments.viewed_at، migration 0255). null = لسه ما فتحوش. */
  viewed_at: string | null;
  responded_at: string | null;
  rejection_reason_code: string | null;
  distance_km: number | null;
  estimated_eta_minutes: number | null;
}

export interface OrderTraceRoundDto {
  round: number;
  started_at: string;
  /**
   * **مهلة توسيع الجولة** — مش انتهاء صلاحية العرض. العرض بيفضل قابل للقبول بعد الوقت ده لحد
   * ما فني تاني ياخد الطلب أو الفني ده يرفض صراحة (راجع matching-round-expiry.processor.ts).
   */
  expansion_due_at: string;
  technicians: OrderTraceTechnicianDto[];
}

export type OrderTraceNextActionDto =
  | 'waiting_technician_response'
  | 'expand_next_round'
  | 'matching_exhausted'
  | 'assigned'
  | 'no_matching_required';

export interface OrderTraceDto {
  order_id: string;
  order_number: string;
  order_status: string;
  is_emergency: boolean;
  current_round: number | null;
  max_rounds: number;
  technicians_contacted: number;
  counts: { sent: number; viewed: number; rejected: number; accepted: number; timeout: number; cancelled: number };
  rounds: OrderTraceRoundDto[];
  next_action: OrderTraceNextActionDto;
  next_action_at: string | null;
  /** ثواني التأخير عن `next_action_at`. 0 = مش متأخر. */
  delay_seconds: number;
}

export interface OrderTraceListResponseDto {
  items: OrderTraceDto[];
}

/** رد تتبّع طلب واحد (GET /admin/operations/order-traces/:orderId) — null لطلب مش موجود. */
export interface OrderTraceResponseDto {
  trace: OrderTraceDto | null;
}
