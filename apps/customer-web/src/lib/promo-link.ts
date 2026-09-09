const PENDING_PROMO_LINK_STORAGE_KEY = 'osta.pendingPromoLink';
const PROMO_LINK_CODE_PATTERN = /^[a-z0-9_-]{3,24}$/i;

/** يعامل الرابط كاقتراح للكود فقط؛ الـAPI وحده يقرر صلاحيته المالية عند الحجز. */
export function normalizePromoLinkCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return PROMO_LINK_CODE_PATTERN.test(normalized) ? normalized : null;
}

export interface PendingPromoLink {
  code: string;
  shouldPrefillDiscount: boolean;
}

export function rememberPendingPromoLinkCode(value: string, shouldPrefillDiscount = true): void {
  const code = normalizePromoLinkCode(value);
  if (code && typeof window !== 'undefined') {
    window.sessionStorage.setItem(PENDING_PROMO_LINK_STORAGE_KEY, JSON.stringify({ code, shouldPrefillDiscount }));
  }
}

export function readPendingPromoLink(): PendingPromoLink | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(PENDING_PROMO_LINK_STORAGE_KEY) ?? 'null') as Partial<PendingPromoLink> | null;
    const code = normalizePromoLinkCode(parsed?.code);
    return code ? { code, shouldPrefillDiscount: parsed?.shouldPrefillDiscount !== false } : null;
  } catch {
    // نسخة محلية قديمة كانت تخزن النص الخام؛ نقبلها مرة واحدة بدل ما نخسر رابط مطبوع موجود.
    const code = normalizePromoLinkCode(window.sessionStorage.getItem(PENDING_PROMO_LINK_STORAGE_KEY));
    return code ? { code, shouldPrefillDiscount: true } : null;
  }
}

export function readPendingPromoLinkCode(): string | null {
  return readPendingPromoLink()?.code ?? null;
}

/** لا نمسح كودًا أحدث وصل من رابط آخر أثناء إتمام طلب قديم. */
export function clearPendingPromoLinkCode(expectedCode?: string): void {
  if (typeof window === 'undefined') return;
  const stored = readPendingPromoLinkCode();
  if (!expectedCode || stored === normalizePromoLinkCode(expectedCode)) {
    window.sessionStorage.removeItem(PENDING_PROMO_LINK_STORAGE_KEY);
  }
}
