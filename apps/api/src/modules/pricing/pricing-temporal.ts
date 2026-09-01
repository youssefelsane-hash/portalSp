import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

/**
 * حسابات التواريخ والمسافات اللي محرك التسعير بيعتمد عليها (ADR-0050 §2/§3).
 *
 * **دوال نقية بلا أي اعتماد على المحرك نفسه** — عشان تتختبر لوحدها، ولأن الغلط فيها بيتحوّل
 * لفلوس غلط على فاتورة حقيقية.
 */

/** كل حسابات التقويم في المنصة بتوقيت القاهرة — نفس ثابت `booking-mode-resolver.ts`. */
export const PLATFORM_TIMEZONE = 'Africa/Cairo';

export type DateDiffUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
export type DateDiffRounding = 'exact' | 'ceil' | 'floor' | 'round';

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface CalendarParts {
  year: number;
  month: number; // 1-12
  day: number;
}

const cairoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * مكوّنات التاريخ بتوقيت القاهرة.
 *
 * **بيتقرا من `Intl` مباشرة، مش بحساب منتصف الليل في JS** — ودي مش تفصيلة أسلوب: المشروع اتلسع
 * قبل كده من `CAIRO_DAY_EXPR` (حساب اليوم من توقيت السيرفر كان بيغلط في أول 3 ساعات من كل يوم
 * مصري)، والحسبة دي هي الوحيدة اللي مافيهاش المشكلة دي أصلاً لأنها مابتعملش أي عملية حسابية على
 * الإزاحة الزمنية.
 */
export function cairoParts(date: Date): CalendarParts {
  const [year, month, day] = cairoFormatter.format(date).split('-').map(Number);
  return { year, month, day };
}

/** اليوم بصيغة `YYYY-MM-DD` بتوقيت القاهرة. */
export function cairoDayString(date: Date): string {
  return cairoFormatter.format(date);
}

/** رقم اليوم المتسلسل من نقطة ثابتة — الفرق بين رقمين = عدد الأيام التقويمية بالظبط. */
function cairoDayNumber(date: Date): number {
  const { year, month, day } = cairoParts(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** عدد أيام شهر تقويمي — بيدخل في الجزء الكسري من فرق الشهور. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * فرق الشهور التقويمية (`to - from`) مع جزء كسري.
 *
 * **مش قسمة على 30.44.** من 1 مارس لـ1 أبريل = **شهر واحد بالظبط**، ومن 1 يناير لـ31 يناير =
 * 30/31 من الشهر. الجزء الكسري متعاير على طول الشهر اللي **بادئ** فيه العدّ — ده اللي بيخلي
 * `ceil()` تدّي «عدد شهور الفوترة» الصح لأي تاريخين.
 */
export function monthsBetween(from: Date, to: Date): number {
  const a = cairoParts(from);
  const b = cairoParts(to);
  const wholeMonths = (b.year - a.year) * 12 + (b.month - a.month);
  const dayDelta = b.day - a.day;
  if (dayDelta === 0) return wholeMonths;
  // القسمة على طول شهر البداية بتخلي أي "شهر كامل" يطلع 1.0 بالظبط مهما كان طول الشهرين.
  return wholeMonths + dayDelta / daysInMonth(a.year, a.month);
}

function applyRounding(value: number, rounding: DateDiffRounding): number {
  switch (rounding) {
    case 'ceil':
      return Math.ceil(value);
    case 'floor':
      return Math.floor(value);
    case 'round':
      return Math.round(value);
    case 'exact':
      return value;
  }
}

export interface DateDiffOptions {
  unit: DateDiffUnit;
  rounding?: DateDiffRounding;
  /** يزوّد 1 لوحدات التقويم — «من 1 لـ 5» = 5 أيام مش 4. */
  inclusive?: boolean;
  absolute?: boolean;
}

/**
 * الفرق بين تاريخين بالوحدة المطلوبة (`to - from`).
 *
 * **الوحدات مش كلها نفس الطبيعة، وده مقصود:**
 * - `minutes`/`hours` = **زمن منقضي فعلي**. الساعة ساعة، والتقويم مالوش لازمة هنا.
 * - `days`/`weeks`/`months` = **تقويم بتوقيت القاهرة**. اللي بيعدّ أيام إيجار بيعدّ تواريخ، مش
 *   وحدات 24 ساعة — حجز من الساعة 11 مساءً النهارده لـ1 صباحًا بكرة **يومين تقويم**، مش ساعتين.
 */
export function dateDiff(from: Date, to: Date, options: DateDiffOptions): number {
  const { unit, rounding = 'exact', inclusive = false, absolute = false } = options;
  let raw: number;
  switch (unit) {
    case 'minutes':
      raw = (to.getTime() - from.getTime()) / 60_000;
      break;
    case 'hours':
      raw = (to.getTime() - from.getTime()) / 3_600_000;
      break;
    case 'days':
      raw = cairoDayNumber(to) - cairoDayNumber(from);
      break;
    case 'weeks':
      raw = (cairoDayNumber(to) - cairoDayNumber(from)) / 7;
      break;
    case 'months':
      raw = monthsBetween(from, to);
      break;
  }
  if (absolute) raw = Math.abs(raw);
  // الشمول قبل التقريب: «من 1 لـ 5 شامل» = 4+1 = 5، مش ceil(4)+1.
  if (inclusive && (unit === 'days' || unit === 'weeks' || unit === 'months')) {
    raw += unit === 'weeks' ? 1 / 7 : 1;
  }
  const result = applyRounding(raw, rounding);
  if (!Number.isFinite(result)) {
    throw new ApiException(ErrorCode.VAL_001, 'فرق التواريخ في معادلة التسعير غير صالح', HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return result;
}

const EARTH_RADIUS_KM = 6371.0088;

/** المسافة الكروية بين نقطتين (Haversine). المرجع الوحيد للمسافة في التسعير. */
export function haversineKm(from: GeoPoint, to: GeoPoint): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * تحويل قيمة حقل `location` (`"lat,lng"`) لنقطة.
 *
 * بترجّع `null` بدل ما ترمي: مصدر مش موجود/مش مفهوم بيترفض في `distance` نفسها برسالة بتسمّي
 * المصدر، وده أوضح للأدمن من خطأ تحويل عام.
 */
export function parseGeoPoint(value: unknown): GeoPoint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const candidate = value as { lat?: unknown; lng?: unknown };
    const lat = Number(candidate.lat);
    const lng = Number(candidate.lng);
    return isValidLatLng(lat, lng) ? { lat, lng } : null;
  }
  const parts = String(value).split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * تحويل قيمة حقل `date`/`time` لتاريخ فعلي.
 *
 * - `date`: `YYYY-MM-DD` بيتفسّر كـ**بداية اليوم بتوقيت القاهرة** (مش UTC) — عشان فرق الأيام
 *   يطابق اللي العميل شافه في التقويم.
 * - `date` بوقت (`YYYY-MM-DDTHH:mm`) أو ISO كامل: بيتفسّر زي ما هو.
 * - `time` لوحده (`HH:mm`): بيترسّى على `1970-01-01`. الفرق بين حقلين وقت بيطلع صح؛ الفرق بين
 *   حقل وقت وتاريخ حقيقي **مالوش معنى** وبيبان فورًا كرقم شاذ بدل ما يعدّي بصمت.
 */
export function parseFieldDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();

  if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const [hours, minutes, seconds = '0'] = text.split(':');
    return new Date(Date.UTC(1970, 0, 1, Number(hours), Number(minutes), Number(seconds)));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return cairoMidnight(text);
  }

  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * لحظة بداية يوم `YYYY-MM-DD` بتوقيت القاهرة، كـ`Date` بتوقيت UTC.
 *
 * الإزاحة بتتقاس **من نفس اليوم المطلوب** مش من دلوقتي — مصر بتغيّر التوقيت الصيفي، وقياس
 * الإزاحة من لحظة تانية كان هيدّي ساعة فرق حوالين أيام التغيير.
 */
export function cairoMidnight(dayString: string): Date {
  const [year, month, day] = dayString.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, day);
  // أول تقدير بإزاحة اليوم نفسه، وتصحيحة واحدة كفاية: الإزاحة ثابتة داخل اليوم إلا في يوم
  // التحويل نفسه، واللي فيه التصحيحة بتوقّع على الجانب الصح.
  const guess = new Date(asUtc - cairoOffsetMs(new Date(asUtc)));
  return new Date(asUtc - cairoOffsetMs(guess));
}

/** إزاحة القاهرة عن UTC بالملي ثانية عند لحظة معيّنة. */
function cairoOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PLATFORM_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const lookup = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    lookup('hour'),
    lookup('minute'),
    lookup('second'),
  );
  return asUtc - at.getTime();
}
