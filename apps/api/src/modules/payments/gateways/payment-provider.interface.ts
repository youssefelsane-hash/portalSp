// واجهة دفع عامة provider-agnostic (ADR-0013) — بتحل محل PaymentGateway الضيقة (card بس، بلا
// refund/void/capture/status/reconcile حقيقيين). أي كود بره الموديول ده بيستهلك الأنواع دي بس،
// مش رد أي بوابة خام — Order/notification/finance ميعرفوش Paymob من Fawry من Cash خالص.

export enum PaymentProviderStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export interface CreatePaymentInput {
  /** id الدفعة عندنا (payments.id) — بيتبعت كـ special_reference/merchant_order_id عشان نربط رد الـwebhook بيه. */
  paymentId: string;
  orderNumber: string;
  amountCents: number;
  currencyCode: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone: string;
}

// discriminated union عمداً — Paymob بيرجّع redirect، Fawry/InstaPay بيرجّعوا reference code
// يدوي، Cash/Wallet بيتنفذوا فورًا من غير أي تفاعل خارجي. إجبار شكل واحد على الكل كان هيبقى
// كذب معماري (راجع "البدائل اللي اتقيّمت" في ADR-0013).
export type CreatePaymentResult =
  | { kind: 'redirect'; checkoutUrl: string; providerReference: string }
  | { kind: 'reference'; referenceCode: string; instructionsAr: string; providerReference: string; expiresAt: Date | null }
  | { kind: 'immediate'; succeeded: boolean };

export interface WebhookVerificationResult {
  /** التوقيع اتحقق منه صح — لو false، الحدث ده لازم يترفض فوراً من غير أي معالجة. */
  signatureValid: boolean;
  /** id فريد للحدث عند البوابة — بيتخزن في webhook_events.external_event_id لمنع المعالجة المكررة. */
  externalEventId: string;
  eventType: string;
  /** id الدفعة عندنا (payments.id) — استخرجناه من special_reference/merchant_order_id اللي بعتناه وقت الإنشاء. */
  paymentId: string | null;
  succeeded: boolean;
  amountCents: number | null;
  gatewayTransactionId: string;
  failureReason: string | null;
}

export interface PaymentStatusResult {
  status: PaymentProviderStatus;
  amountCents: number | null;
  succeeded: boolean;
}

export interface RefundInput {
  /** transaction id عند البوابة (مش payments.id عندنا) — Paymob مثلاً محتاجه بالظبط لـvoid_refund/refund. */
  providerReference: string;
  amountCents: number;
  reasonAr: string;
}

export interface RefundResult {
  succeeded: boolean;
  providerRefundId: string | null;
  status: PaymentProviderStatus;
  failureReason: string | null;
}

export interface VoidResult {
  succeeded: boolean;
  failureReason: string | null;
}

export interface CaptureResult {
  succeeded: boolean;
  failureReason: string | null;
}

export interface ReconcileResult {
  status: PaymentProviderStatus;
  amountCents: number | null;
}

export class PaymentOperationNotSupportedError extends Error {
  constructor(providerKey: string, operation: string) {
    super(`${providerKey} مش بيدعم ${operation}`);
  }
}

export interface PaymentProvider {
  readonly providerKey: string;
  readonly isConfigured: boolean;
  readonly supportsRefund: boolean;
  readonly supportsVoid: boolean;
  readonly supportsCapture: boolean;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** بيتحقق من التوقيع ويفك تشفير حمولة الـwebhook — مزامن تماماً (حساب توقيع بس، مفيش I/O). */
  verifyWebhook(rawPayload: Record<string, unknown>, signature: string | undefined): WebhookVerificationResult;
  /** استعلام مباشر لحالة معاملة — بيتستخدم في reconcile() وفي أي مسار مش عايز يستنى webhook. */
  getPaymentStatus(providerReference: string): Promise<PaymentStatusResult>;
  /** يرمي PaymentOperationNotSupportedError لو !supportsRefund — الكولر (payments.service.ts) بيعمل fallback لـwallet credit. */
  refund(input: RefundInput): Promise<RefundResult>;
  void(providerReference: string): Promise<VoidResult>;
  capture(providerReference: string, amountCents: number): Promise<CaptureResult>;
  /** استعلام مباشر لحالة معاملة معلّقة — لو الـwebhook متأخر أو مش موثوق. */
  reconcile(providerReference: string): Promise<ReconcileResult>;
}
