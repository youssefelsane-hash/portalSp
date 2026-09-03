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
  responded_at: string | null;
  // بس لـkind='assignment' (order_assignments عنده expires_at حقيقي) — دايمًا null لـwork_opportunity.
  expires_at: string | null;
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

/** شغلانة معادها عدّى والفني لسه ما بدأش — أعجل بند في المركز (docs/08 §56 بند 4). */
export interface OverdueOrderExceptionItemDto {
  order_id: string;
  order_number: string;
  scheduled_at: string;
  technician_id: string | null;
  technician_code: string | null;
  full_name: string | null;
  days_late: number;
}

/**
 * توسيع جولة مطابقة متأخر — **الـengine نفسه واقف**، مش مجرد عرض عدّى معاده.
 *
 * الفرق الجوهري عن `stale_dispatch` تحته: `order_assignments.expires_at` معناها «امتى النظام
 * هيوسّع البث» مش «امتى العرض بيبطل» (ADR-0018 §5)، فأي عرض عدّى معاده بيولّع `stale_dispatch`
 * حتى لو الـworkflow سليم تمامًا. البند ده بيولّع بس لما وقت التوسيع عدّى **والجولة الجاية ما
 * اتعملتش** والطلب لسه بيدوّر **وتحت سقف الجولات** — يعني تدخّل بشري مطلوب فعلاً.
 * كل الحقول محسوبة في الباك-إند (`deriveMatchingWorkflowState`) — الواجهة ماتشتقّش أي منها.
 */
export interface MatchingWorkflowDelayedItemDto {
  order_id: string;
  order_number: string;
  order_status: string;
  current_round: number;
  max_rounds: number;
  technicians_contacted: number;
  pending_responses: number;
  /** امتى كان **مفروض** التوسيع يحصل. */
  expected_action_at: string;
  delay_seconds: number;
}

export interface ExceptionCenterResponseDto {
  overdue_orders: { items: OverdueOrderExceptionItemDto[]; total: number };
  matching_workflow_delayed: { items: MatchingWorkflowDelayedItemDto[]; total: number };
  crew_shortage: { items: CrewShortageExceptionItemDto[]; total: number };
  stale_dispatch: { items: StaleDispatchExceptionItemDto[]; total: number };
}

/**
 * مرحلة الـmatching workflow — مصدرها الوحيد `deriveMatchingWorkflowState` في الباك-إند
 * (apps/api/src/modules/matching/matching-workflow-state.ts). ممنوع على أي واجهة تشتق المرحلة
 * دي من مقارنة وقت محلي: الوقت اللي عند المتصفح مش وقت النظام، والقواعد (مهلة السماح، سقف
 * الجولات) إعدادات بتتغير من لوحة التحكم.
 */
export type MatchingWorkflowPhaseDto =
  | 'not_matching'
  | 'not_dispatched'
  | 'awaiting_technician_response'
  | 'round_expansion_due'
  | 'rounds_exhausted';

/** مصدر إسناد الطلب — مشتق في الباك-إند من الحقيقة المحفوظة، مش عمود مستقل. */
export type OrderAssignmentSourceDto =
  | 'customer_selected'
  | 'post_quote_selection'
  | 'revisit_pinned'
  | 'admin_assignment'
  | 'auto_match'
  | 'not_assigned';

/**
 * التحكم اللحظي في التوزيع (GET /admin/operations/live-dispatch) — صف لكل طلب لسه بيدوّر على
 * فني. مكمّل لـ`DispatchDeliveryResponseDto` فوق (feed أحداث مسطح بالزمن) مش بديل ليه: نفس
 * الجداول، سؤالين مختلفين.
 *
 * الرد متعشّش (`orders: {items, meta}` مش items/meta على المستوى الأول) لنفس سبب
 * `DispatchDeliveryResponseDto`: ResponseInterceptor بيفرد أي رد فيه items+meta فوق **ويقطع
 * `summary` بصمت**.
 */
export interface LiveDispatchRowDto {
  order_id: string;
  order_number: string;
  service_name_ar: string;
  booking_mode: string;
  order_type: string;
  /** بيدوّر من كام ثانية — محسوبة في الباك-إند بوقت الخادم. */
  searching_since_seconds: number;
  current_round: number;
  max_rounds: number;
  technicians_contacted: number;
  pending: number;
  viewed: number;
  rejected: number;
  accepted: number;
  workflow_phase: MatchingWorkflowPhaseDto;
  /** النص العربي جاهز من الباك-إند — الواجهة مابتترجمش المرحلة بنفسها. */
  workflow_phase_ar: string;
  next_action_at: string | null;
  delay_seconds: number;
  is_delayed: boolean;
}

export interface LiveDispatchSummaryDto {
  /** كل الطلبات اللي بتدوّر ومطابقة للفلاتر — **قبل** سقف الصفوف وقبل فلتر «المتأخر بس». */
  total_searching: number;
  /**
   * `true` لما العدد الحقيقي عدّى سقف الصفوف، يعني في طلبات بتدوّر **مش معروضة**. الواجهة لازم
   * تقول ده صراحةً: شاشة شغلها «ورّيني اللي واقف» ممنوع تخبّي طلب واقف في صمت.
   */
  truncated: boolean;
}

export interface LiveDispatchResponseDto {
  summary: LiveDispatchSummaryDto;
  orders: { items: LiveDispatchRowDto[]; meta: { page: number; per_page: number; total: number } };
}

/**
 * حالة مطابقة طلب واحد (GET /admin/orders/:id/matching-state) — «مين استلم، وإمتى، وردّ إيه،
 * والخطوة الجاية إيه».
 *
 * تحذير تسمية مقصود: `broadcast_expands_at` مش «انتهاء صلاحية العرض» — العرض بيفضل قابل للقبول
 * بعدها (ADR-0018 §5). الاسم بيعكس المعنى الحقيقي للعمود عشان الواجهة ما تعرضهوش كـ«انتهى».
 */
export interface OrderMatchingAttemptDto {
  assignment_id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  rejection_reason_code: string | null;
  distance_km: number | null;
  eta_minutes: number | null;
  sent_at: string;
  /** null للصفوف اللي قبل migration 0255، أو اللي الفني ماشافهاش أصلاً. */
  viewed_at: string | null;
  responded_at: string | null;
}

export interface OrderMatchingRoundDto {
  round: number;
  started_at: string;
  /** وقت **توسيع البث** لفنيين إضافيين — مش انتهاء صلاحية العرض (ADR-0018 §5). */
  broadcast_expands_at: string;
  attempts: OrderMatchingAttemptDto[];
}

export interface OrderMatchingWorkflowDto {
  phase: MatchingWorkflowPhaseDto;
  /** النص العربي جاهز من الباك-إند — الواجهة مابتترجمش المرحلة بنفسها. */
  phase_label_ar: string;
  next_action_at: string | null;
  delay_seconds: number;
  is_delayed: boolean;
}

export interface OrderMatchingStateDto {
  order_id: string;
  order_status: string;
  assignment_source: OrderAssignmentSourceDto;
  assignment_source_label_ar: string;
  assigned_technician_id: string | null;
  current_round: number;
  max_rounds: number;
  technicians_contacted: number;
  counts: { sent: number; viewed: number; accepted: number; rejected: number; timeout: number; cancelled: number };
  workflow: OrderMatchingWorkflowDto;
  rounds: OrderMatchingRoundDto[];
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
