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
  technician_id: string;
  technician_code: string;
  full_name: string;
  sent_at: string;
  expires_at: string;
}

export interface ExceptionCenterResponseDto {
  crew_shortage: { items: CrewShortageExceptionItemDto[]; total: number };
  stale_dispatch: { items: StaleDispatchExceptionItemDto[]; total: number };
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
