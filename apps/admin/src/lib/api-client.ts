import type { ApiEnvelope } from '@baytak/shared-types';

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
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  const envelope = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || !envelope.success) {
    throw new ApiError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'حصل خطأ غير متوقع',
      res.status,
    );
  }

  return envelope.data as T;
}
