import type { KpiValue } from '@baytak/shared-types';
import { formatEgp } from '@/lib/format';

/** آخر ٣٠ يوم — نفس الافتراضي اللي الـAPI بيستخدمه لما مايوصلوش مدى. */
export const DEFAULT_RANGE_DAYS = 30;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * `to` في الـAPI **حصري** (`< to`)، فلو الأدمن كتب «لحد ٣٠ سبتمبر» وبعتنا التاريخ زي ما هو
 * كان يوم ٣٠ نفسه هيقع بره الفترة. بنبعت أول اليوم اللي بعده.
 */
export function exclusiveTo(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function inclusiveFrom(dateIso: string): string {
  return `${dateIso}T00:00:00.000Z`;
}

const NUMBER_FORMAT = new Intl.NumberFormat('ar-EG-u-nu-latn');

export function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** «٩٠ ثانية» مش رقم مفيد للإدارة — بنحوّلها لدقايق/ساعات. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} ثانية`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} دقيقة`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  // الساعات بتوصل لعشرات الألوف في القدرة الكلية — من غير فاصلة الآلاف الرقم مايتقراش.
  return mins === 0 ? `${NUMBER_FORMAT.format(hours)} ساعة` : `${NUMBER_FORMAT.format(hours)} ساعة و${mins} دقيقة`;
}

/**
 * مدة **بالدقايق**. مش مجرّد `formatDuration(minutes * 60)`: الصفر كان بيطلع «٠ ثانية» في
 * كارت مكتوب عليه «المحجوز فعلاً» — وحدة غلط بتخلّي الرقم يبان كأنه بيقيس حاجة تانية.
 * اتلقطت في المراجعة البصرية الحية لصفحة القوى العاملة.
 */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 دقيقة';
  return formatDuration(minutes * 60);
}

/**
 * عرض قيمة مقياس. **الـ`null` بيتعرض كـ«غير متاح» مش صفر** — ده بالظبط الفرق اللي الـAPI
 * تعب عشان يحافظ عليه (ADR-0081 §1)، وضياعه في الواجهة بيرجّع الكذب اللي اتمنع في الباك-إند.
 */
export function formatKpiValue(kpi: KpiValue): string {
  if (kpi.value === null) return 'غير متاح';
  switch (kpi.unit) {
    case 'cents':
      return formatEgp(kpi.value);
    case 'percent':
      return `${kpi.value}%`;
    case 'seconds':
      return formatDuration(kpi.value);
    case 'count':
    default:
      return formatCount(kpi.value);
  }
}
