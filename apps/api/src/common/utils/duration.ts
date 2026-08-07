const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

// بيحوّل '15m' / '30d' / '1h' لملي ثانية — مطابق لصيغة JWT_*_EXPIRES_IN في .env
export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`صيغة مدة غير مفهومة: ${duration}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_TO_MS[unit];
}
