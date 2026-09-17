// عقد استجابة الـ API الموحّد — docs/02-data-dictionary.md §13
export interface ApiMeta {
  page?: number;
  per_page?: number;
  total?: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  /**
   * سبب آلي ثابت فوق الرسالة العربية — اختياري تمامًا (ADR-0101).
   *
   * الرسالة موجّهة للمستخدم وبتتغيّر بتغيّر الصياغة؛ الكود ده موجّه للواجهة/الأدمن عشان يقدروا
   * يفرّقوا بين الأسباب برمجيًا بدل مطابقة نص. أول مستهلك: أسباب رفض خانة الطاقم.
   */
  reason?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  meta: ApiMeta | null;
  error: ApiErrorBody | null;
  request_id: string;
}
