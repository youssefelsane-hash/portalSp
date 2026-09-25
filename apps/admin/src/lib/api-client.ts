import type { ApiEnvelope, ApiMeta } from '@baytak/shared-types';
import { reportClientError } from './error-reporter';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

// نداء مباشر لـ apps/api (الأصل مختلف عن apps/admin، فمحتاج CORS مفعّل هناك) — بيرفق
// Authorization header بالـ access_token القصير العمر الموجود في الذاكرة. أي 401 لازم
// يتعامل معاه الكولر (عادة عبر useAuthenticatedFetch اللي بيحاول refresh مرة واحدة ويعيد المحاولة).
export async function apiFetch<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<T> {
  // FormData (رفع ملفات، زي البراندنج) لازم الـbrowser نفسه يحدد Content-Type (multipart/form-data
  // + boundary) — تحديده يدوي بـ application/json هنا هيكسر الرفع تمامًا.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch (networkError) {
    // فشل شبكة قبل أي رد: الاستثناء الخام كان بيطلع للشاشة بلا أي رسالة مفهومة.
    reportClientError({
      kind: 'network',
      errorName: networkError instanceof Error ? networkError.name : 'NetworkError',
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
      apiPath: path,
    });
    throw new ApiError('NETWORK', 'مفيش اتصال بالسيرفر — اتأكد من الشبكة وحاول تاني', 0);
  }

  const envelope = await readEnvelope<T>(res, path);

  if (!res.ok || !envelope.success) {
    // 5xx و429/408 بس — 4xx غالبًا سلوك متوقّع (تحقق/صلاحية) وتسجيله بيغرق الإشارة الحقيقية.
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      reportClientError({
        kind: 'api',
        errorName: envelope.error?.code ?? 'ApiError',
        errorMessage: envelope.error?.message ?? `HTTP ${res.status}`,
        apiPath: path,
        apiStatus: res.status,
      });
    }
    throw new ApiError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'حصل خطأ غير متوقع',
      res.status,
    );
  }

  return envelope.data as T;
}

/**
 * **رد مش JSON بيبقى خطأ مفهوم** — نفس إصلاح `apps/customer-web/src/lib/api-client.ts`.
 *
 * `await res.json()` الخام كان بيرمي `SyntaxError` لما الرد يبقى HTML (proxy، بوابة شبكة،
 * صفحة خطأ من طبقة فوقنا) — الشاشة بتفضل على التحميل بلا رسالة، وماحدش بيعرف السبب.
 */
async function readEnvelope<T>(res: Response, path: string): Promise<ApiEnvelope<T>> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    reportClientError({
      kind: 'api',
      errorName: 'BadResponse',
      errorMessage: 'رد غير JSON',
      apiPath: path,
      apiStatus: res.status,
    });
    throw new ApiError('BAD_RESPONSE', 'رد السيرفر غير مفهوم — حاول تاني', res.status);
  }
}

// زي apiFetch بس بيرجّع meta (page/per_page/total) كمان — للـ endpoints اللي بترجع قايمة
// مُقسّمة صفحات (ResponseInterceptor في apps/api بيكتشف شكل {items, meta} تلقائي ويفكّه).
export async function apiFetchPaginated<T>(
  path: string,
  accessToken: string | null,
  options: RequestInit = {},
): Promise<{ items: T[]; meta: ApiMeta }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  const envelope = (await res.json()) as ApiEnvelope<T[]>;

  if (!res.ok || !envelope.success) {
    throw new ApiError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'حصل خطأ غير متوقع',
      res.status,
    );
  }

  return { items: envelope.data ?? [], meta: envelope.meta ?? {} };
}
