// إعادة حساب الأعمدة المحسوبة على customer_profiles (total/completed/cancelled_orders_count,
// total_spent_cents, first/last_order_at, average_rating_given) بمهمة خلفية مجدولة — نفس النمط
// بالظبط المستخدم في technicians/technician-stats.queue.ts، ومطابق لـ docs/02-data-dictionary.md
// §14.4 ("الأعمدة المحسوبة تتحدّث بمهمة خلفية مجدولة، مش داخل معاملة الطلب نفسها").
export const CUSTOMER_STATS_QUEUE = 'customer-stats';
export const RECALCULATE_CUSTOMER_STATS_JOB = 'recalculate-stats';

export interface RecalculateCustomerStatsJobData {
  customerProfileId: string;
}
