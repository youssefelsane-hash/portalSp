import { ApiEnvelope } from './api-types';
import { funnelHeaders } from './funnel';

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
  const res = await fetch(`${API_URL}${path}`, {
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

  const envelope = await readEnvelope<T>(res);

  if (!res.ok || !envelope.success) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }

  return envelope.data as T;
}

/**
 * قراءة الـenvelope مع تحويل «رد مش JSON» لخطأ مفهوم.
 *
 * رد HTML من proxy/captive portal كان بيرمي `SyntaxError` خام — الصفحة بتفضل على حالة التحميل
 * بلا رسالة، بالظبط زي فئة البَقّة اللي في `apps/customer-app/lib/core/api_client.dart`.
 */
async function readEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
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
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...funnelHeaders(),
      ...options.headers,
    },
  });
  const envelope = await readEnvelope<T[]>(res);
  if (!res.ok || !envelope.success) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }
  return {
    items: Array.isArray(envelope.data) ? envelope.data : [],
    meta: (envelope.meta as Record<string, unknown> | null) ?? {},
  };
}

// لـendpoints عامة (كتالوج/بحث) بترجع قايمة خام مش envelope مُقسّم صفحات — مطابق لعقد
// service-response.dto.ts (راجع apps/customer-app's apiRequestList لنفس النمط بالضبط).
export async function apiFetchList<T>(path: string, accessToken: string | null = null): Promise<T[]> {
  const data = await apiFetch<unknown>(path, accessToken);
  return (data as T[]) ?? [];
}
