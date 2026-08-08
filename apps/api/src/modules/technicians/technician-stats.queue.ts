// إعادة حساب الأعمدة المحسوبة على technician_profiles (average_rating, total_ratings_count,
// completed_orders_count) بمهمة خلفية مجدولة — مطابق حرفياً لـ docs/02-data-dictionary.md §14.4:
// "الأعمدة المحسوبة تتحدّث بمهمة خلفية مجدولة، مش داخل معاملة الطلب نفسها — عشان الأداء."
export const TECHNICIAN_STATS_QUEUE = 'technician-stats';
export const RECALCULATE_STATS_JOB = 'recalculate-stats';

export interface RecalculateStatsJobData {
  technicianProfileId: string;
}
