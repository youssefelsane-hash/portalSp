// ساعات الهدوء (ADR-0012، docs/08 §15) — كل الأوقات UTC (نفس اتفاقية المشروع، CLAUDE.md §1.3).
// نطاق ممكن يعدّي منتصف الليل (مثلاً 22:00 → 08:00) — بيتعامل معاه بشكل صريح.

function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinQuietHours(date: Date, startHHMM: string, endHHMM: string): boolean {
  const minutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);

  if (start === end) return false; // نطاق صفري = مفيش ساعات هدوء أصلاً
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  // نطاق عادي على مدى اليوم (مثلاً 09:00 → 17:00 لو حد استخدمها كده)
  return minutesOfDay >= start || minutesOfDay < end; // عدّى منتصف الليل (مثلاً 22:00 → 08:00)
}

/** أقرب لحظة برّه ساعات الهدوء بعد `date` — لو `date` أصلاً برّاها، بترجعها زي ما هي. */
export function nextTimeOutsideQuietHours(date: Date, startHHMM: string, endHHMM: string): Date {
  if (!isWithinQuietHours(date, startHHMM, endHHMM)) return date;

  const end = parseHHMM(endHHMM);
  const result = new Date(date);
  result.setUTCHours(Math.floor(end / 60), end % 60, 0, 0);
  if (result <= date) result.setUTCDate(result.getUTCDate() + 1); // نهاية الهدوء فاتت النهارده، يبقى بكرة
  return result;
}
