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
