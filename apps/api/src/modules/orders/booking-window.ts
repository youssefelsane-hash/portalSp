import { PLATFORM_TIMEZONE } from './booking-mode-resolver';

/**
 * **نافذة اختيار الموعد** (طلب مالك 2026-09-15، docs/08 §151، ADR-0097).
 *
 * > «مواعيد الشغل عندنا الـcustomer ينفع يختارها… بتكون من الساعة ٥ صباحًا إلى الساعة ٧ مساءً.
 * >  الشغل عادي بقى في أي وقت، والـschedule عادي بيتحسب زي ما هو… عدد الساعات بتزيد أو عدد
 * >  الأيام بتزيد بعد الفترة اللي الـcustomer اختار فيها، ولكن هو **الاختيار نفسه** مش مسموح
 * >  له يختار حاجة برا الحدود دي.»
 *
 * ### القيد على **البداية** بس، ومقصود كده
 *
 * الشغل نفسه بيمتد بحرية: شغلانة بتبدأ ٦ مساءً وبتاخد ٤ ساعات بتخلص ١٠ مساءً عادي، وشغلانة
 * بتاخد تلات أيام بتكمّل على أيامها. القاعدة دي **مابتلمسش** حساب المدة ولا الطاقة اليومية ولا
 * التوزيع — هي بوابة على اللحظة اللي العميل بيختارها كبداية وبس. أي قيد على النهاية كان هيمنع
 * شغلانات حقيقية بلا أي طلب من المالك.
 *
 * ### ليه الحساب بتوقيت المنصّة مش بتوقيت الجهاز
 *
 * العميل بيختار «٦ مساءً» بتوقيت القاهرة، والقيمة بتتبعت UTC. المقارنة بالساعة المحلية للسيرفر
 * (أو للجهاز) كانت هتدّي نافذة مختلفة لكل جهاز. نفس قاعدة `platformDayOf()` بالحرف.
 */
export interface BookingWindow {
  /** أول ساعة مسموح البدء فيها (بتوقيت المنصّة). */
  startHour: number;
  /** آخر ساعة مسموح البدء فيها — **شاملة**: ١٩ معناها ٧:٠٠ مساءً بالظبط مقبولة، و٧:٣٠ لأ. */
  endHour: number;
}

export const DEFAULT_BOOKING_WINDOW: BookingWindow = { startHour: 5, endHour: 19 };

/** دقيقة اليوم بتوقيت المنصّة — الأساس اللي المقارنة كلها بتتم عليه. */
export function platformMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PLATFORM_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * نافذة بحدود سليمة — بتتصلّح هنا مش عند القراءة.
 *
 * إعداد مقلوب (بداية بعد نهاية) أو خارج ٠..٢٣ كان هيقفل الحجز بالكامل على المنصّة كلها من
 * غير ما حد يقصد. فالقيم بتتحصر، ولو فضلت مقلوبة بنرجع للافتراضي بدل ما نرفض كل الطلبات.
 */
export function normalizeBookingWindow(window: BookingWindow): BookingWindow {
  const startHour = Math.min(23, Math.max(0, Math.round(window.startHour)));
  const endHour = Math.min(23, Math.max(0, Math.round(window.endHour)));
  return startHour <= endHour ? { startHour, endHour } : DEFAULT_BOOKING_WINDOW;
}

export function isWithinBookingWindow(date: Date, window: BookingWindow): boolean {
  const { startHour, endHour } = normalizeBookingWindow(window);
  const minutes = platformMinutesOfDay(date);
  return minutes >= startHour * 60 && minutes <= endHour * 60;
}

/**
 * **«اليوم المجرّد» — منتصف الليل UTC بالظبط** (ADR-0018 §2).
 *
 * الاتفاقية دي مكتوبة في المنصّة كلها: طلب على يوم بلا ساعة محددة بيتبعت `T00:00:00.000Z`.
 * وهي **مش اختيار ساعة من العميل** — هي حشو مكان الساعة.
 *
 * والتفرقة دي ضرورية لأن `T00:00:00.000Z` بتوقيت القاهرة هي ٢ أو ٣ الفجر (حسب التوقيت
 * الصيفي)، يعني **برّه النافذة**. من غير الاستثناء ده، النافذة كانت هترفض كل حجز «يوم بس»
 * على المنصّة — وده اتلقط فعلاً: ١٤ اختبار قايم فشلوا أول ما الحارس اتضاف، وكلهم بيحجزوا
 * بالاتفاقية دي.
 */
export function isBareDayPlaceholder(date: Date): boolean {
  return date.getTime() % 86_400_000 === 0;
}

/**
 * هل الموعد ده **اختيار ساعة حقيقي من العميل** يستاهل الفحص؟
 *
 * شرطين مع بعض:
 *  1. الخدمة بتطلب ساعة بداية أصلاً (`requires_start_time_only`) — غير كده العميل ماشافش
 *     منتقي وقت خالص، فمفيش «اختيار» نحكم عليه.
 *  2. القيمة مش «اليوم المجرّد» (فوق).
 */
export function bookingWindowApplies(opts: {
  scheduledAt: Date;
  serviceRequiresStartTime: boolean;
}): boolean {
  return opts.serviceRequiresStartTime && !isBareDayPlaceholder(opts.scheduledAt);
}

/** «٥ ص» / «٧ م» — الصيغة اللي العميل بيقراها، مش 24 ساعة. */
export function formatWindowHourAr(hour: number): string {
  if (hour === 0) return '١٢ منتصف الليل';
  if (hour === 12) return '١٢ الظهر';
  const suffix = hour < 12 ? 'ص' : 'م';
  const display = hour <= 12 ? hour : hour - 12;
  return `${display} ${suffix}`;
}

/** قارئ إعدادات مصغّر — نفس نمط `resolveDailyCapacityMinutes()`، عشان الملف يفضل بلا DI. */
export interface NumberSettingReader {
  getNumber(key: string, fallback: number): Promise<number>;
}

/**
 * النافذة من الإعدادات — **نقطة القراءة الوحيدة**، فالتحقق والعرض بيقروا نفس الرقم.
 *
 * أي سطح تاني بيكتب `5`/`19` في كوده بيخلق نافذة تانية تنحرف أول ما الأدمن يغيّر الإعداد.
 */
export async function resolveBookingWindowSetting(settings: NumberSettingReader): Promise<BookingWindow> {
  const [startHour, endHour] = await Promise.all([
    settings.getNumber('booking.selectable_start_hour', DEFAULT_BOOKING_WINDOW.startHour),
    settings.getNumber('booking.selectable_end_hour', DEFAULT_BOOKING_WINDOW.endHour),
  ]);
  return normalizeBookingWindow({ startHour, endHour });
}

export function bookingWindowMessageAr(window: BookingWindow): string {
  const { startHour, endHour } = normalizeBookingWindow(window);
  return `مواعيد بدء الشغل من ${formatWindowHourAr(startHour)} لـ${formatWindowHourAr(
    endHour,
  )} — اختار وقت بداية جوّه الفترة دي. الشغل نفسه ممكن يكمّل بعدها عادي.`;
}
