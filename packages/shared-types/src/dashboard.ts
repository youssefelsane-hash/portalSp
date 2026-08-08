// مطابق لـ apps/api/src/modules/admin/admin-reports.service.ts (DashboardStats)
export interface DashboardStats {
  orders_today: { total: number; completed: number; active: number; cancelled: number };
  revenue_today_cents: number;
  platform_commission_today_cents: number;
  technicians: { approved: number; pending_verification: number; available_now: number };
  complaints_open: number;
  average_rating: number | null;
  users: { total: number; new_today: number; by_user_type: Record<string, number> };
  financial: { pending_payouts_count: number; pending_payouts_amount_cents: number };
}
