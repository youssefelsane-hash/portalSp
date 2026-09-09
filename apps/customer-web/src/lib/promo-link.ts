const PENDING_PROMO_LINK_STORAGE_KEY = 'osta.pendingPromoLinkCode';
const PROMO_LINK_CODE_PATTERN = /^[a-z0-9_-]{3,24}$/i;

/** يعامل الرابط كاقتراح للكود فقط؛ الـAPI وحده يقرر صلاحيته المالية عند الحجز. */
export function normalizePromoLinkCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return PROMO_LINK_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function rememberPendingPromoLinkCode(value: string): void {
  const code = normalizePromoLinkCode(value);
  if (code && typeof window !== 'undefined') window.sessionStorage.setItem(PENDING_PROMO_LINK_STORAGE_KEY, code);
}

export function readPendingPromoLinkCode(): string | null {
  if (typeof window === 'undefined') return null;
  return normalizePromoLinkCode(window.sessionStorage.getItem(PENDING_PROMO_LINK_STORAGE_KEY));
}

/** لا نمسح كودًا أحدث وصل من رابط آخر أثناء إتمام طلب قديم. */
export function clearPendingPromoLinkCode(expectedCode?: string): void {
  if (typeof window === 'undefined') return;
  const stored = readPendingPromoLinkCode();
  if (!expectedCode || stored === normalizePromoLinkCode(expectedCode)) {
    window.sessionStorage.removeItem(PENDING_PROMO_LINK_STORAGE_KEY);
  }
}
