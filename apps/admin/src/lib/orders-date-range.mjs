const cairoDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** @param {Date} instant */
export function cairoDay(instant) {
  const parts = Object.fromEntries(cairoDateFormatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** @param {string} day @param {number} offset */
function addCalendarDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** اليوم المختار هو اليوم الأول، بغض النظر عن توقيت جهاز الأدمن. */
/** @param {number} days @param {Date} [now] */
export function ordersDateRange(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer');
  const from = cairoDay(now);
  return { from, to: addCalendarDays(from, days - 1) };
}

/** @param {string} from @param {string} to @param {Date} [now] */
export function matchingOrdersPreset(from, to, now = new Date()) {
  if (!from || !to || from !== cairoDay(now)) return '';
  for (const days of [1, 7, 30]) {
    if (to === addCalendarDays(from, days - 1)) return String(days);
  }
  return '';
}
