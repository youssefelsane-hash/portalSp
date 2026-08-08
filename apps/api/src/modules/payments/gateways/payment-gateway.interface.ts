// واجهة بوابة الدفع بالبطاقة — نفس فلسفة StorageService/NotificationDispatcher (common/storage,
// common/notifications): أي كود بيستخدم الواجهة دي بس، مش التطبيق الفعلي. تبديل البوابة
// (Paymob → Fawry → Stripe → إلخ) = تطبيق جديد للواجهة + تغيير provider واحد في payments.module.ts.

export interface CreateCardPaymentInput {
  /** id الدفعة عندنا (payments.id) — بيتبعت كـ merchant_order_id/extra_data عشان نربط رد الـ webhook بيه. */
  paymentId: string;
  orderNumber: string;
  amountCents: number;
  currencyCode: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface CreateCardPaymentResult {
  /** رابط iframe الدفع المستضاف — الكلاينت (customer-app) بيفتحه في WebView. */
  redirectUrl: string;
  /** id الطلب عند البوابة — للمراجعة/الدعم بس، مش مفتاح البحث الأساسي (ده paymentId بتاعنا). */
  gatewayOrderId: string;
}

export interface WebhookVerificationResult {
  /** التوقيع (HMAC) اتحقق منه صح — لو false، الحدث ده لازم يترفض فوراً من غير أي معالجة. */
  signatureValid: boolean;
  /** id فريد للحدث عند البوابة — بيتخزن في webhook_events.external_event_id لمنع المعالجة المكررة. */
  externalEventId: string;
  eventType: string;
  /** id الدفعة عندنا (payments.id) — استخرجناه من merchant_order_id اللي بعتناه وقت الإنشاء. */
  paymentId: string | null;
  /** نجحت العملية فعلياً عند البوابة (مش بس "اتسلّم الحدث"). */
  succeeded: boolean;
  amountCents: number | null;
  gatewayTransactionId: string;
  failureReason: string | null;
}

/** بوابة دفع بالبطاقة قابلة للتبديل — Paymob هي التطبيق الحقيقي، DisabledPaymentGateway fallback آمن. */
export interface PaymentGateway {
  readonly providerName: string;
  readonly isConfigured: boolean;
  createCardPayment(input: CreateCardPaymentInput): Promise<CreateCardPaymentResult>;
  /** بيتحقق من التوقيع ويفك تشفير حمولة الـ webhook — مزامن تماماً (حساب HMAC بس، مفيش I/O). */
  verifyAndParseWebhook(rawPayload: Record<string, unknown>, hmacFromQuery: string | undefined): WebhookVerificationResult;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
