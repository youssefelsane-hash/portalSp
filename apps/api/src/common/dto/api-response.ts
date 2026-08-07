// عقد استجابة الـ API الموحّد — docs/02-data-dictionary.md §13
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
