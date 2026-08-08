// عقد استجابة الـ API الموحّد — نسخة طبق الأصل من apps/api/src/common/dto/api-response.ts
// (docs/02-data-dictionary.md §13). أي تغيير هنا لازم يتزامن مع النسخة الأصلية في apps/api.
export interface ApiMeta {
  page?: number;
  per_page?: number;
  total?: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  meta: ApiMeta | null;
  error: ApiErrorBody | null;
  request_id: string;
}
