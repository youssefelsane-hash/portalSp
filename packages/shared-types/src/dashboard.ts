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

// مطابق لـ RevenuePeriodRow/ZoneReportRow/TechnicianReportRow في admin-reports.service.ts
export interface RevenuePeriodRow {
  period_start: string;
  orders_count: number;
  total_amount_cents: number;
  platform_commission_cents: number;
  technician_earnings_cents: number;
}

export interface ZoneReportRow {
  zone_id: string;
  name_ar: string;
  name_en: string;
  city_id: string;
  city_name_ar: string;
  is_active: boolean;
  surge_multiplier: string;
  orders_count: number;
  completed_orders_count: number;
  revenue_cents: number;
  platform_commission_cents: number;
  active_technicians_count: number;
}

export interface TechnicianReportRow {
  technician_id: string;
  technician_code: string;
  full_name: string;
  current_level: string;
  completed_orders_count: number;
  cancelled_orders_count: number;
  average_rating: number;
  quality_score: number;
  avg_response_seconds: number | null;
  open_complaints_count: number;
}

export type ReportGroupBy = 'day' | 'week' | 'month';
export type TechniciansReportSortBy = 'completed_orders' | 'average_rating' | 'cancelled_orders' | 'quality_score';
