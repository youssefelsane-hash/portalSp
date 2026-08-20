import type { TechnicianCapacityTier } from './technicians';
import type { OrderStatus } from './orders';

// مطابق لـ apps/api/src/modules/orders/admin-orders.controller.ts §36.5 endpoints — واجهة فوق
// MatchingExplainabilityService الموجود بالفعل (docs/08 §35.7/§35.8)، صفر خوارزمية تشخيصية موازية.

export interface TechnicianEligibilityCheckDto {
  key: string;
  passed: boolean;
  label_ar: string;
}

// GET /admin/orders/:id/technicians/:technicianId/explain (§35.7)
export interface TechnicianEligibilityExplanationDto {
  technician_id: string;
  order_id: string;
  eligible: boolean;
  reason_ar: string;
  capacity_tier: TechnicianCapacityTier | null;
  distance_km: string | null;
  checks: TechnicianEligibilityCheckDto[];
}

export interface OrderMatchingFunnelPoolCountsDto {
  category_eligible: number;
  zone_eligible: number;
  blocked: number;
  heavy: number;
  meaningful: number;
  light: number;
}

export interface OrderAssignmentStatusCountsDto {
  sent: number;
  viewed: number;
  accepted: number;
  rejected: number;
  timeout: number;
  cancelled: number;
}

export interface WorkOpportunityStatusCountsDto {
  offered: number;
  accepted: number;
  declined: number;
  closed: number;
}

// ملحوظة تسمية متعمّدة: عكس باقي حقول الملف ده، الحقول هنا camelCase مش snake_case — الـcontroller
// (admin-orders.controller.ts، getDetail() وgetMatchingFunnel() الاتنين) بيمرّر كائن CrewComposition
// من order-team.service.ts مباشرة من غير أي تحويل تسمية (`crew_status: crewStatus`) — سلوك حقيقي
// موجود بالفعل في الكود، مش اختراع هنا. توثيق الواقع الفعلي على السلك، مش الاتساق النظري.
export interface OrderMatchingFunnelCrewStatusDto {
  requiredTechnicians: number;
  requiredAssistants: number;
  assignedTechnicians: number;
  assignedAssistants: number;
  missingTechnicians: number;
  missingAssistants: number;
  crewComplete: boolean;
}

// GET /admin/orders/:id/matching-funnel (§35.8)
export interface OrderMatchingFunnelDto {
  order_id: string;
  order_status: OrderStatus;
  pool: OrderMatchingFunnelPoolCountsDto;
  dispatch_assignments: OrderAssignmentStatusCountsDto;
  crew_recruit_opportunities: WorkOpportunityStatusCountsDto | null;
  crew_status: OrderMatchingFunnelCrewStatusDto | null;
}
