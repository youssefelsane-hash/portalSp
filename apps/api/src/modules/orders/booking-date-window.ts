import { platformDayOf } from './booking-mode-resolver';

/** الإعداد الافتراضي لحجز خدمة مستقبلية؛ يُقرأ من settings وقت التشغيل. */
export const MAX_ADVANCE_BOOKING_DAYS_FALLBACK = 90;

export type BookingDateWindowViolation = 'past' | 'too_far';

interface BookingDateWindowInput {
  scheduledAt?: string | Date | null;
  scheduledAtRangeEnd?: string | Date | null;
  maxAdvanceDays: number;
  now?: Date;
}

/**
 * يتحقق من اليوم المدني في القاهرة، لا من فرق 24 ساعة. لذلك تغيير التوقيت الصيفي أو ساعة
 * الموعد لا يحول حجز الغد إلى ماضٍ أو العكس.
 */
export function bookingDateWindowViolation(input: BookingDateWindowInput): BookingDateWindowViolation | null {
  const dates = [input.scheduledAt, input.scheduledAtRangeEnd].filter((value): value is string | Date => Boolean(value));
  if (dates.length === 0) return null;

  const today = platformDayOf(input.now ?? new Date());
  const maxDays = Math.max(0, Math.floor(input.maxAdvanceDays));
  const latest = addCalendarDays(today, maxDays);

  for (const value of dates) {
    const day = platformDayOf(value instanceof Date ? value : new Date(value));
    if (day < today) return 'past';
    if (day > latest) return 'too_far';
  }
  return null;
}

function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, date + days));
  return result.toISOString().slice(0, 10);
}
