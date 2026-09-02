/**
 * دقة الموعد المطلوبة من العميل — **وضعين بس** (ADR-0060 §4).
 *
 * قبل كده كانت أربع بوليانات على `services` (`requires_precise_schedule`,
 * `requires_start_time_only`, `requires_hours_only`, `requires_start_and_end`) مع قيد تبادل على
 * مستوى الداتابيز، وكل واحد ليه فرع تحقق مستقل في `OrdersService.create()` و
 * `RecurringOrdersService.create()`. تلاتة منهم كانوا بيطلبوا من العميل **مدخلات تسعير** (مدة،
 * فترة) وهي مسؤولية محرك التسعير مش الجدولة — وده اللي طلّع «أربع حقول تاريخ» على نفس الشاشة.
 *
 * دلوقتي الجدولة بتجاوب على سؤال واحد: **امتى الفني ييجي؟**
 *   `full_day`   → تاريخ بس (الافتراضي)
 *   `start_time` → تاريخ + ساعة وصول
 *
 * المدة بتيجي من ناتج المعادلة (`computed_duration_days` / `duration_minutes`) مش من رقم العميل.
 */
export type SchedulePrecision = 'full_day' | 'start_time';

export const SCHEDULE_PRECISION_LABELS_AR: Record<SchedulePrecision, string> = {
  full_day: 'يوم كامل',
  start_time: 'وقت بداية فقط',
};

/** نقطة القراءة الوحيدة — أي فرع بيسأل عن دقة الموعد بيسأل من هنا. */
export function schedulePrecision(service: { requiresStartTimeOnly: boolean }): SchedulePrecision {
  return service.requiresStartTimeOnly ? 'start_time' : 'full_day';
}
