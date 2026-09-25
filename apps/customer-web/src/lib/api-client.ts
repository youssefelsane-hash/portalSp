import { ApiEnvelope } from './api-types';
import { funnelHeaders } from './funnel';
import { reportClientError } from './error-reporter';
import { notifyNetworkFailure, notifyNetworkSuccess } from './connectivity';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// نفس نمط apps/admin/src/lib/api-client.ts بالحرف — نداء مباشر لـapps/api من المتصفح (أصل
// مختلف، محتاج CORS_ORIGIN تتضمن دومين customer-web في env.validation.ts وقت النشر الحقيقي؛
// الكود بيدعم أصول متعددة مفصولة بفاصلة من زمان). Authorization header بالـaccess_token القصير
// العمر من الذاكرة — 401 لازم يتعامل معاه authedFetch (auth-context.tsx) بمحاولة refresh واحدة.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export async function apiFetch<T>(path: string, accessToken: string | null, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let res: Response;
  try {
    res = await rawFetch(path, accessToken, options, isFormData);
  } catch (networkError) {
    // **فشل شبكة قبل أي رد** — مفيش status ومفيش envelope. ده اللي المستخدم بيسمّيه «الموقع مش
    // بيفتح»، وكان بيضيع بالكامل: الاستثناء بيطلع لواجهة الاستدعاء وخلاص.
    notifyNetworkFailure();
    reportClientError({
      kind: 'network',
      errorName: networkError instanceof Error ? networkError.name : 'NetworkError',
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
      apiPath: path,
    });
    throw new ApiError('NETWORK', 'مفيش اتصال بالسيرفر — اتأكد من الإنترنت وحاول تاني', 0);
  }

  // وصل رد = الشبكة والسيرفر واصلين، مهما كان كود الرد. الشريط بيختفي من غير أي تدخل.
  notifyNetworkSuccess();
  const envelope = await readEnvelope<T>(res, path);

  if (!res.ok || !envelope.success) {
    // **5xx و0 بس بيتبلّغوا** — 4xx غالبًا سلوك متوقّع (تحقق، صلاحية، مفيش نتيجة)، وتسجيله
    // بيغرق الإشارة الحقيقية في ضوضاء. الاستثناء المقصود: 429 و408 (ضغط/بطء) بيدخلوا لأنهم
    // بيقولوا حاجة عن حالة النظام مش عن المستخدم.
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      reportClientError({
        kind: 'api',
        errorName: envelope.error?.code ?? 'ApiError',
        errorMessage: envelope.error?.message ?? `HTTP ${res.status}`,
        apiPath: path,
        apiStatus: res.status,
      });
    }
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }

  return envelope.data as T;
}

function rawFetch(
  path: string,
  accessToken: string | null,
  options: RequestInit,
  isFormData: boolean,
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      // معرّف محاولة الحجز على **كل** نداء (ADR-0081 §3): السيرفر بيسجّل مراحله بنفسه، وبيحتاج
      // المعرّف ده عشان يربطها بخطوات المتصفح. حطه هنا مرة واحدة بدل ما كل نداء حجز يفتكره —
      // النسيان في نداء واحد كان بيقطع الرحلة نصّين في التقرير.
      ...funnelHeaders(),
      ...options.headers,
    },
  });
}

/**
 * قراءة الـenvelope مع تحويل «رد مش JSON» لخطأ مفهوم.
 *
 * رد HTML من proxy/captive portal كان بيرمي `SyntaxError` خام — الصفحة بتفضل على حالة التحميل
 * بلا رسالة، بالظبط زي فئة البَقّة اللي في `apps/customer-app/lib/core/api_client.dart`.
 */
async function readEnvelope<T>(res: Response, path: string): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    // رد مش JSON = proxy أو صفحة خطأ من طبقة تحتنا. بيتبلّغ لأنه **مش** خطأ تطبيق وماحدش
    // هيشوفه في لوجات الـAPI أصلاً.
    reportClientError({ kind: 'api', errorName: 'BadResponse', errorMessage: 'رد غير JSON', apiPath: path, apiStatus: res.status });
    throw new ApiError('BAD_RESPONSE', 'رد السيرفر غير مفهوم — حاول تاني', res.status);
  }
}

/**
 * نداء لـendpoint مُقسّم صفحات (`{items, meta}` عند الكونترولر).
 *
 * **بَقّة حقيقية (بلاغ مالك 2026-09-10)**: `ResponseInterceptor` في الباك-إند بيرفع `items`
 * لـ`data` ويحط `meta` **جنبها** في الـenvelope، فالرد `{data: [...], meta: {...}}` مش
 * `{data: {items, meta}}`. الكود اللي بيقرا `page.items` كان بياخد `undefined` و`page.meta`
 * بترمي TypeError — نفس بَقّة «طلباتي ما بتفتحش» في تطبيق الأندرويد بالحرف. الدالة دي هي
 * العقد الصح، مكتوب مرة واحدة بدل ما كل استدعاء يخمّنه.
 */
export async function apiFetchPage<T>(
  path: string,
  accessToken: string | null = null,
  options: RequestInit = {},
): Promise<{ items: T[]; meta: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await rawFetch(path, accessToken, options, false);
  } catch (networkError) {
    notifyNetworkFailure();
    reportClientError({
      kind: 'network',
      errorName: networkError instanceof Error ? networkError.name : 'NetworkError',
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
      apiPath: path,
    });
    throw new ApiError('NETWORK', 'مفيش اتصال بالسيرفر — اتأكد من الإنترنت وحاول تاني', 0);
  }
  notifyNetworkSuccess();
  const envelope = await readEnvelope<T[]>(res, path);
  if (!res.ok || !envelope.success) {
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      reportClientError({
        kind: 'api',
        errorName: envelope.error?.code ?? 'ApiError',
        errorMessage: envelope.error?.message ?? `HTTP ${res.status}`,
        apiPath: path,
        apiStatus: res.status,
      });
    }
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }
  return {
    items: Array.isArray(envelope.data) ? envelope.data : [],
    meta: (envelope.meta as Record<string, unknown> | null) ?? {},
  };
}

// لـendpoints عامة (كتالوج/بحث) بترجع قايمة خام مش envelope مُقسّم صفحات — مطابق لعقد
// service-response.dto.ts (راجع apps/customer-app's apiRequestList لنفس النمط بالضبط).
export async function apiFetchList<T>(path: string, accessToken: string | null = null, options: RequestInit = {}): Promise<T[]> {
  const data = await apiFetch<unknown>(path, accessToken, options);
  return (data as T[]) ?? [];
}
