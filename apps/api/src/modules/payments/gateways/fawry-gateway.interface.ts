// واجهة منفصلة عن PaymentGateway (Paymob) عمداً — شكل الرد مختلف جوهرياً: مفيش redirect_url/iframe
// خالص، الرد كود مرجعي (referenceNumber) العميل بياخده لأقرب منفذ فوري ويدفع كاش فعلياً هناك،
// والتأكيد بييجي بعدين عبر webhook زي الكارت بالظبط. إجباره في شكل PaymentGateway كان هيبقى
// مضلّل (مفيش "رابط" حقيقي نفتحه في WebView).

export interface CreateFawryReferenceInput {
  /** id الدفعة عندنا (payments.id) — بيتبعت كـ merchantRefNum عشان نربط رد الـ webhook بيه. */
  paymentId: string;
  orderNumber: string;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
}

export interface CreateFawryReferenceResult {
  /** الكود المرجعي اللي العميل بياخده لأقرب منفذ فوري ويدفعه كاش. */
  referenceNumber: string;
  expiresAt: Date;
  /** id العملية عند FawryPay — للمراجعة/الدعم بس. */
  gatewayOrderId: string;
}

export interface FawryWebhookVerificationResult {
  signatureValid: boolean;
  externalEventId: string;
  eventType: string;
  paymentId: string | null;
  succeeded: boolean;
  amountCents: number | null;
  gatewayTransactionId: string;
  failureReason: string | null;
}

export interface FawryGateway {
  readonly providerName: string;
  readonly isConfigured: boolean;
  createReference(input: CreateFawryReferenceInput): Promise<CreateFawryReferenceResult>;
  verifyAndParseWebhook(rawPayload: Record<string, unknown>): FawryWebhookVerificationResult;
}

export const FAWRY_GATEWAY = Symbol('FAWRY_GATEWAY');
