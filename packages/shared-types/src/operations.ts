// مطابق لـ apps/api/src/modules/operations/admin-operations.controller.ts (docs/08 §36.2 —
// بداية "مركز العمليات" الجديد، هيتوسّع مرحلة بمرحلة حسب §36.3-14).
export interface OperationsOverview {
  dispatch_pending_count: number;
  crew_shortage_open_count: number;
  technicians_online_count: number;
  capacity_today: { light: number; meaningful: number; heavy: number; blocked: number };
}
