/**
 * **فشل الشبكة العابر** (docs/08 §187) — مشترك بين `apps/customer-web` و`apps/admin`.
 *
 * كل أخطاء «شبكة» اللي اتسجلت في أسبوع (`TypeError: Failed to fetch`) كانت في رشقات: كذا نداء
 * من نفس تحميل الصفحة بيفشلوا في نفس الثانية، والبلاغ عنهم نفسه **وصل السيرفر** بعدها مباشرةً —
 * يعني السيرفر وCORS كانوا شغّالين، والانقطاع كان لحظي عند المستخدم (موبايل اتقفل/اتنقل للخلفية،
 * شبكة اتبدّلت). محاولة واحدة تانية بتنقذ القراءة، والسياق بيتكتب في البلاغ بدل ما نخمّن.
 */

export const NETWORK_RETRY_DELAY_MS = 700;

/** قراءة بس: تكرار POST/PATCH/DELETE بعد فشل شبكة ممكن ينفّذ نفس العملية مرتين على السيرفر. */
export function isSafeToRetry(method?: string): boolean {
  const normalized = (method ?? 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function isAbort(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * بينفّذ `doFetch`، ولو رمى (مفيش رد خالص) لقراءة مش ملغية عمدًا بيحاول **مرة واحدة** كمان.
 * فشل المحاولة التانية بيطلع زي ما هو. أي رد من السيرفر (حتى 5xx) مابيتعادش هنا.
 */
export async function fetchWithOneRetry(
  doFetch: () => Promise<Response>,
  options: { method?: string; signal?: AbortSignal | null } = {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  try {
    return await doFetch();
  } catch (firstError) {
    if (!isSafeToRetry(options.method) || isAbort(firstError, options.signal)) throw firstError;
    await sleep(NETWORK_RETRY_DELAY_MS);
    return doFetch();
  }
}

/** سياق فشل الشبكة للبلاغ: الجهاز من غير إنترنت، أو الصفحة في الخلفية (الموبايل بيقطع طلباتها). */
export function networkFailureContext(): 'offline' | 'page-hidden' | null {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'page-hidden';
  return null;
}

/** رسالة الخطأ + السياق لو معروف، عشان شاشة «أخطاء واجهة المستخدم» تقول السبب مش بس «Failed to fetch». */
export function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const context = networkFailureContext();
  return context ? `${message} [${context}]` : message;
}
