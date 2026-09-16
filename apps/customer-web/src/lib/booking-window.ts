import { apiFetch } from './api-client';

/**
 * **نافذة اختيار الموعد + تحويل توقيت القاهرة** (ADR-0097، docs/08 §151).
 *
 * الملف ده بيحلّ حاجتين مربوطين ببعض، وتصليح واحدة من غير التانية بيكسر الويب:
 *
 * 1. **النافذة**: العميل مايقدرش يختار بداية برّه ٥ص–٧م. الأرقام بتيجي من السيرفر عشان تعديل
 *    الأدمن يوصل من غير نشر، وعشان الواجهة مستحيل تسمح بوقت السيرفر بيرفضه.
 *
 * 2. **بَقّة توقيت حقيقية كانت موجودة قبل النافذة** (اتلقطت وقت تنفيذ §151): الويب كان بيبني
 *    الموعد كـ`${date}T${time}:00.000Z` — يعني بياخد الساعة اللي العميل اختارها **بتوقيت
 *    القاهرة** ويلزق عليها `Z` كأنها UTC. النتيجة إن العميل يختار ٦ م والفني يشوف ٩ م
 *    (فرق الإزاحة، وبيتغيّر بالتوقيت الصيفي). التطبيق مكانش عنده البَقّة دي أصلاً
 *    (`DateTime(...).toUtc()` بتحوّل صح)، فالويب والتطبيق كانوا بيبعتوا لحظتين مختلفتين
 *    لنفس الاختيار.
 *
 *    ومن غير التصليح ده، النافذة الجديدة كانت هترفض اختيارات سليمة على الويب — وكان هيبان
 *    إن النافذة هي اللي بوّظت، مش إنها كشفت بَقّة قايمة.
 */
export interface BookingWindowDto {
  start_hour: number;
  end_hour: number;
  message_ar: string;
}

export const FALLBACK_BOOKING_WINDOW: BookingWindowDto = {
  start_hour: 5,
  end_hour: 19,
  message_ar: 'مواعيد بدء الشغل من 5 ص لـ7 م — اختار وقت بداية جوّه الفترة دي. الشغل نفسه ممكن يكمّل بعدها عادي.',
};

export const fetchBookingWindow = async (): Promise<BookingWindowDto> => {
  try {
    return await apiFetch<BookingWindowDto>('/settings/booking-window', null);
  } catch {
    // فشل نداء إعدادات مايقفلش شاشة الحجز — السيرفر هو الحارس الحقيقي على أي حال.
    return FALLBACK_BOOKING_WINDOW;
  }
};

/** إزاحة توقيت القاهرة (بالدقايق) في تاريخ معيّن — بتتحسب مش مكتوبة، عشان التوقيت الصيفي. */
function cairoOffsetMinutes(dateStr: string): number {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const asCairo = new Date(probe.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const asUtc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((asCairo.getTime() - asUtc.getTime()) / 60_000);
}

/**
 * `YYYY-MM-DD` + `HH:MM` **بتوقيت القاهرة** ⇒ لحظة ISO بالـUTC.
 *
 * ده اللي بيخلي الويب يبعت نفس اللحظة اللي التطبيق بيبعتها لنفس الاختيار بالظبط.
 */
export function cairoWallClockToIso(dateStr: string, timeStr: string): string {
  const offset = cairoOffsetMinutes(dateStr);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${dateStr}T${timeStr}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return new Date(iso).toISOString();
}

/** نفس قاعدة السيرفر بالحرف: الساعة الأخيرة **شاملة** عند الدقيقة صفر. */
export function isTimeWithinWindow(timeStr: string, window: BookingWindowDto): boolean {
  const [hour, minute] = timeStr.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= window.start_hour * 60 && minutes <= window.end_hour * 60;
}
