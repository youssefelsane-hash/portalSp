import { quietHoursStartBefore } from '../notifications/quiet-hours.util';

/**
 * نفس حد T-24 بتاع تحصيل الكارت المتكرر: النوبة لازم تكون مدفوعة قبل موعدها بيوم عشان المطابقة
 * تلحق تلاقي منفّذ.
 */
export const RECURRING_PAYMENT_LAST_CALL_HOURS = 24;

/** `action_type` لتذكيرات دفع النوبة في `notification_workflows` — نقطة الحل الواحدة للدفع/التبليغ/الإلغاء. */
export const RECURRING_PAYMENT_REMINDER_ACTION = 'pay_recurring_occurrence';

export interface RecurringManualPaymentDeadlineInput {
  generatedAt: Date;
  scheduledAt: Date;
  /** `recurring.manual_payment_window_hours` */
  windowHours: number;
  /** `orders.payment_timeout_minutes` — مهلة الطلب العادي، أقل حاجة ممكنة. */
  minimumMinutes: number;
  quietHoursStart: string;
  quietHoursEnd: string;
}

/**
 * آخر ميعاد لدفع نوبة متكررة يدوية (ADR-0116). بيتحسب مرة واحدة وقت التوليد ويتخزن على الطلب.
 *
 * ١. المهلة من الإعداد، ٢. مايعدّيش الموعد − 24 ساعة، ٣. لو وقع جوّه ساعات الهدوء بيتقدّم لبدايتها
 * (التذكير الأخير لازم يلحق)، ٤. عمره ما يقل عن مهلة الطلب العادي (نوبة اتولّدت متأخرة = سلوك قديم).
 */
export function recurringManualPaymentDeadline(input: RecurringManualPaymentDeadlineInput): Date {
  const hour = 60 * 60_000;
  const floor = input.generatedAt.getTime() + input.minimumMinutes * 60_000;
  const windowEnd = input.generatedAt.getTime() + input.windowHours * hour;
  const lastCall = input.scheduledAt.getTime() - RECURRING_PAYMENT_LAST_CALL_HOURS * hour;
  const raw = new Date(Math.min(windowEnd, lastCall));
  const outsideQuiet = quietHoursStartBefore(raw, input.quietHoursStart, input.quietHoursEnd);
  return new Date(Math.max(floor, outsideQuiet.getTime()));
}
