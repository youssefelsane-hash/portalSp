import { ApiEnvelope } from './api-types';

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
      ...options.headers,
    },
  });

  const envelope = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || !envelope.success) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'حصل خطأ غير متوقع', res.status);
  }

  return envelope.data as T;
}

// لـendpoints عامة (كتالوج/بحث) بترجع قايمة خام مش envelope مُقسّم صفحات — مطابق لعقد
// service-response.dto.ts (راجع apps/customer-app's apiRequestList لنفس النمط بالضبط).
export async function apiFetchList<T>(path: string, accessToken: string | null = null): Promise<T[]> {
  const data = await apiFetch<unknown>(path, accessToken);
  return (data as T[]) ?? [];
}
