/**
 * **إبلاغ عن أخطاء الواجهة** (ADR-0114).
 *
 * قبل ده: خطأ بيحصل في متصفح العميل — رندر مكسور، شبكة قاطعة، استدعاء بيرجع 500 — وماحدش
 * بيعرف. كنا بنعرف بالمشكلة لما حد يكلّم الدعم، لو كلّم.
 *
 * ### قواعد التصميم اللي المفروض تفضل محفوظة
 *
 * 1. **الإبلاغ ما يكسرش حاجة أبدًا**: كل نداء هنا fire-and-forget بلا `await` في مسار المستخدم،
 *    وأي فشل بيتاكل بالكامل. مستحيل إن الإبلاغ عن خطأ يبقى هو نفسه خطأ يشوف المستخدم.
 * 2. **مفيش بيانات شخصية**: المسار بيتطهّر من المعرفات والأرقام **هنا كمان** (السيرفر بيطهّر
 *    تاني — الطبقتين مقصودين)، ومفيش أي حقل بيتقرا من بيانات المستخدم.
 * 3. **سقف لكل جلسة**: صفحة بتفشل في حلقة رندر كانت تقدر تبعت مئات الطلبات. `MAX_PER_SESSION`
 *    و`SUPPRESS_MS` بيخلّوا نفس الخطأ يتبلّغ مرة واحدة كل فترة — الإشارة نفسها مش بتضيع
 *    (السيرفر بيعدّ زوّار مش أحداث).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export type ClientErrorKind = 'render' | 'api' | 'network' | 'unhandled_rejection' | 'not_found';

interface ReportInput {
  kind: ClientErrorKind;
  errorName?: string | null;
  errorMessage?: string | null;
  componentStack?: string | null;
  apiPath?: string | null;
  apiStatus?: number | null;
  pagePath?: string;
}

/** سقف الجلسة: بعده بنسكت خالص. حلقة رندر مكسورة مش سبب لمئات الطلبات. */
const MAX_PER_SESSION = 12;
/** نفس البصمة مابتتكررش قبل الفترة دي. */
const SUPPRESS_MS = 60_000;

let sent = 0;
const lastSentAt = new Map<string, number>();

/**
 * تطهير المسار: المعرفات والأرقام بتتحوّل لرموز ثابتة.
 *
 * سببين: التجميع (من غيره كل طلب صف لوحده فالجدول يبقى سجل مش قياس)، والأمان (مسار ممكن يكون
 * فيه بالغلط رقم أو توكن في الـquery، والـquery بتتشال بالكامل هنا).
 */
export function sanitizePagePath(raw: string): string {
  const path = raw.split('#')[0].split('?')[0];
  return path
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':id')
    .replace(/\+?\d{7,}/g, ':num')
    .replace(/\/\d+(?=\/|$)/g, '/:num')
    .slice(0, 300);
}

export function reportClientError(input: ReportInput): void {
  // SSR/بناء: مفيش متصفح ومفيش مستخدم — مفيش حاجة تتبلّغ.
  if (typeof window === 'undefined') return;
  if (sent >= MAX_PER_SESSION) return;

  const pagePath = sanitizePagePath(input.pagePath ?? window.location.pathname);
  const apiPath = input.apiPath ? sanitizePagePath(input.apiPath) : null;
  const key = [input.kind, pagePath, input.errorName ?? '', apiPath ?? '', input.apiStatus ?? ''].join('|');
  const now = Date.now();
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < SUPPRESS_MS) return;
  lastSentAt.set(key, now);
  sent += 1;

  const body = JSON.stringify({
    app: 'customer-web',
    kind: input.kind,
    page_path: pagePath,
    ...(input.errorName ? { error_name: input.errorName.slice(0, 120) } : {}),
    ...(input.errorMessage ? { error_message: input.errorMessage.slice(0, 500) } : {}),
    ...(input.componentStack ? { component_stack: input.componentStack.slice(0, 4000) } : {}),
    ...(apiPath ? { api_path: apiPath } : {}),
    ...(typeof input.apiStatus === 'number' ? { api_status: input.apiStatus } : {}),
  });

  // `keepalive` عشان البلاغ يعدّي حتى لو المستخدم قفل الصفحة أو انتقل بعد الخطأ — وده بالظبط
  // اللي بيحصل بعد شاشة خطأ: الناس بتسيب. من غيره أكتر البلاغات المهمة كانت بتتقطع.
  void fetch(`${API_URL}/telemetry/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // مقصود: الإبلاغ عن خطأ ماينفعش يرمي خطأ. لو الشبكة واقعة أصلاً، البلاغ نفسه مش هيوصل —
    // ومفيش حاجة نعملها ولا حاجة نعرضها للمستخدم.
  });
}

/**
 * الأخطاء اللي مابتوصلش لأي `error.tsx`: وعود مرفوضة وأخطاء عامة في الـwindow. Next بيلقط أخطاء
 * الرندر بس، فدي فئة كاملة كانت بتضيع بالكامل.
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __ostaErrorReportingInstalled?: boolean };
  if (w.__ostaErrorReportingInstalled) return;
  w.__ostaErrorReportingInstalled = true;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: string; message?: string } | undefined;
    reportClientError({
      kind: 'unhandled_rejection',
      errorName: reason?.name ?? 'UnhandledRejection',
      errorMessage: reason?.message ?? String(event.reason ?? ''),
    });
  });

  window.addEventListener('error', (event) => {
    // أخطاء تحميل المصادر (صورة/سكربت) بتيجي بلا `error` object — بتتبلّغ كشبكة لأن ده سببها
    // الغالب، ومفيدة: صورة كتالوج مكسورة عند نص المستخدمين مشكلة حقيقية مش بتوصل للدعم أبدًا.
    if (!event.error) {
      reportClientError({ kind: 'network', errorName: 'ResourceError', errorMessage: event.message });
      return;
    }
    reportClientError({
      kind: 'render',
      errorName: event.error?.name ?? 'Error',
      errorMessage: event.error?.message ?? event.message,
    });
  });
}
