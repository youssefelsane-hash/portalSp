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

export interface FawryReferenceResponseDto {
  payment: PaymentResponseDto;
  reference_number: string;
  expires_at: string | null;
}

/**
 * **الدفع بكود مرجعي في منافذ فوري** (ADR-0013).
 *
 * الـendpoint شغّال من زمان والتطبيق بيستخدمه، والويب كان **بيخفي الوسيلة بالكامل** من قايمة
 * الدفع عن قصد («فوري والتقسيط ليهم مسارات مالهاش واجهة هنا لسه») — وده كان الصح وقتها، لأن
 * عرض وسيلة بلا صفحة بتوصّل العميل لطريق مسدود. دلوقتي الصفحة موجودة فالوسيلة اتفتحت.
 *
 * مفيش تحويل لبوابة خارجية هنا: الرد نفسه هو الكود اللي العميل بياخده للمنفذ.
 */
export const payWithFawryReference = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<FawryReferenceResponseDto>(`/orders/${orderId}/pay-with-fawry-reference`, {
    method: 'POST',
    // **مفتاح مشتق من الطلب مش `randomUUID()`** — وده الفرق بين صفحة سليمة ودفعتين لنفس الطلب.
    //
    // صفحة الكارت بتولّد مفتاح جديد كل ضغطة وده صح هناك: العميل بيروح لبوابة خارجية ومابيرجعش
    // للصفحة. الصفحة دي عنوان ثابت العميل بيفتحه تاني وتالت (بيقفل الصفحة ويرجع يدوّر على
    // الكود قبل ما يروح المنفذ). مفتاح جديد كل مرة = دفعة جديدة كل refresh.
    //
    // بالمفتاح الثابت الباك-إند بيرجّع `cached_result` — **نفس الكود المرجعي** — من غير أي
    // إنشاء جديد (`payments.service.ts`: `findOne({ where: { idempotencyKey } })`).
    headers: { 'Idempotency-Key': `fawry-${orderId}` },
  });

/**
 * الدفع من رصيد المحفظة (docs/08 §165).
 *
 * الرصيد ده حقيقي: بييجي من استرداد طلب ملغي، أو تعويض شكوى، أو تعديل إداري. الـendpoint
 * موجود وشغّال من زمان والتطبيق بيستخدمه، لكن **الويب مكانش فيه أي مسار له خالص** — فعميل
 * معاه 120 ج في محفظته كان بيشوف الرقم في صفحة «محفظتي» ومايقدرش يدفع بيه من المتصفح.
 */
export const payWithWallet = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<PaymentResponseDto>(`/orders/${orderId}/pay-with-wallet`, {
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

/**
 * **معاينة الدفع بـInstaPay جوّه الطلب** (ADR-0089) — قراءة بحتة، مابتفتحش أي دفعة.
 *
 * ده اللي بيخلّي خانة «ادفع بـInstaPay» تعرض الحساب والمبلغ **من غير** ما تقفل مسار الكاش:
 * نداء `payWithInstaPay` كان هيفتح دفعة معلّقة لأي حد بيبص على الطلب.
 */
export interface InstaPayPreviewDto {
  amount_cents: number;
  /** السعر المعتاد قبل حافز InstaPay، للعرض فقط. */
  cash_amount_cents: number;
  /** الحافز الثابت الممول من المنصة، بالقروش. */
  instapay_discount_cents: number;
  recipient_address: string | null;
  recipient_name: string | null;
  instructions_ar: string;
  qr_image_url: string | null;
  reference_code: string;
  confirm_typical_minutes: number;
  confirm_max_minutes: number;
  has_open_transfer: boolean;
  is_payable: boolean;
  /** الشغل لسه ما خلصش — دفع مسبق، والسعر ممكن يزيد ببند إضافي بعدين (ADR-0091). */
  is_prepayment: boolean;
  /** زيادة على طلب مدفوع بالفعل — بتتدفع لوحدها وبلا حافز. */
  is_additional_charge: boolean;
  /** الطلب اتقفل — خانة الدفع كلها بتختفي، مش بتتعطّل (docs/08 §150 بند ٤). */
  is_closed: boolean;
}

export const previewInstaPay = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<InstaPayPreviewDto>(`/orders/${orderId}/instapay-preview`);
