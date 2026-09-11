import { PaymentChannelDto } from './api-types';

export type { PaymentChannelDto };

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export const fetchPaymentChannels = (authedFetch: AuthedFetch) => authedFetch<PaymentChannelDto[]>('/payment-channels');

export interface PaymentResponseDto {
  id: string;
  payment_number: string;
  order_id: string;
  amount_cents: number;
  payment_method: string;
  payment_status: string;
  completed_at: string | null;
  order_item_batch_id: string | null;
}

export interface CardPaymentResponseDto {
  payment: PaymentResponseDto;
  redirect_url: string;
}

// كل عملية دفع لازم Idempotency-Key فريد (docs/01 §1.4) — منتج مرة واحدة لكل محاولة زرار،
// عشان أي إعادة إرسال (شبكة بطيئة، دبل-كليك) ماتعملش دفعتين لنفس الطلب.
export const payWithCard = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<CardPaymentResponseDto>(`/orders/${orderId}/pay-with-card`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });

/**
 * تفاصيل تحويل InstaPay — **مطابقة حرفيًا لـ`InstaPayReferenceResponseDto`** في الباك-إند.
 *
 * الأرقام (الحساب، المبلغ، رقم الطلب) حقول مستقلة **مش مدفونة جوّه `instructions_ar`**: رقم
 * لاتيني جوّه فقرة عربية بيتعرض بترتيب خانات مقلوب (bidi)، والعميل بينسخ رقم حساب غلط — على
 * تحويل بنكي حقيقي. الواجهة بتعرض كل واحد في سطر LTR مستقل مع زرار نسخ.
 */
export interface InstaPayReferenceDto {
  payment: PaymentResponseDto;
  reference_code: string;
  instructions_ar: string;
  qr_image_url: string | null;
  recipient_address: string | null;
  recipient_name: string | null;
  amount_cents: number;
  confirm_typical_minutes: number;
  confirm_max_minutes: number;
}

/** بدء تحويل InstaPay — **كتابة**، فبتطلب `Idempotency-Key` زي أي مسار دفع. */
export const payWithInstaPay = (authedFetch: AuthedFetch, orderId: string, idempotencyKey: string) =>
  authedFetch<InstaPayReferenceDto>(`/orders/${orderId}/pay-with-instapay`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });

/**
 * استئناف تحويل مفتوح — **قراءة بحتة**، فمفيش `Idempotency-Key` ولا أثر على السيرفر.
 *
 * ده مش مسار استثنائي: InstaPay بطبيعته بيطلب من العميل يسيب موقعنا ويفتح تطبيق البنك ويرجع.
 * من غير المسار ده، الرجوع لصفحة التحويل كان معناه نداء `pay-with-instapay` تاني.
 */
export const getInstaPayTransfer = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<InstaPayReferenceDto>(`/orders/${orderId}/instapay-transfer`);

/** العميل بيقول «حوّلت» — بيتسجّل في الباك-إند عشان الأدمن يعرف مين مستني مراجعة. */
export const confirmInstaPayTransfer = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<PaymentResponseDto>(`/orders/${orderId}/confirm-instapay-transfer`, { method: 'POST' });
