import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentOperationNotSupportedError,
  PaymentProvider,
  PaymentProviderStatus,
  PaymentStatusResult,
  ReconcileResult,
  RefundInput,
  RefundResult,
  VoidResult,
  WebhookVerificationResult,
} from './payment-provider.interface';

interface PaymobIntentionResponse {
  client_secret: string;
  intention_order_id: number;
  status: string;
}

interface PaymobTransactionObj {
  id: number;
  amount_cents: number;
  success: boolean;
  pending: boolean;
  error_occured: boolean;
  is_refunded: boolean;
  is_voided: boolean;
  is_capture: boolean;
  is_standalone_payment: boolean;
  is_auth: boolean;
  is_3d_secure: boolean;
  has_parent_transaction: boolean;
  integration_id: number;
  owner: number;
  created_at: string;
  currency: string;
  order: { id: number; merchant_order_id?: string | null };
  source_data?: { pan?: string; sub_type?: string; type?: string };
  data?: { message?: string };
}

interface PaymobWebhookPayload {
  type?: string;
  obj: PaymobTransactionObj;
}

interface PaymobAuthTokenResponse {
  token: string;
}

interface PaymobTransactionInquiryResponse {
  id: number;
  success: boolean;
  pending: boolean;
  is_refunded: boolean;
  is_voided: boolean;
  amount_cents: number;
}

/**
 * تكامل حقيقي مع Paymob Accept عبر **Intention API** (ADR-0013 — ترقية من الـflow القديم
 * auth/order/payment_key المهجور، حسب طلب صريح من المالك "follow the current recommended
 * Intention API flow"). كل الحقول اتأكدت من الـPostman collections الرسمية
 * (github.com/PaymobAccept/API-Postman-Collections، developers.paymob.com/docs.paymob.com محجوبين
 * في بيئة التنفيذ دي) — صفر حقل مخترع، تفاصيل كاملة في docs/adr/0013-payment-provider-abstraction.md.
 *
 * ملحوظة مصادقة مهمة: Intention/Refund/Void/Capture بتستخدم `Authorization: Token {secret_key}`،
 * لكن Transaction Inquiry (getPaymentStatus/reconcile) لسه بتستخدم آلية قديمة منفصلة
 * (`auth_token` من `POST /api/auth/tokens` بـapi_key، بعدين `Authorization: Bearer {auth_token}`) —
 * الاتنين بيتعايشوا هنا عمداً، مش خطأ.
 */
@Injectable()
export class PaymobProvider implements PaymentProvider {
  readonly providerKey = 'paymob';
  readonly isConfigured: boolean;
  readonly supportsRefund = true;
  readonly supportsVoid = true;
  readonly supportsCapture = true;
  private readonly logger = new Logger('PaymentProvider(paymob)');

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly secretKey: string | undefined;
  private readonly publicKey: string | undefined;
  private readonly integrationIdCard: string | undefined;
  private readonly hmacSecret: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('payments.paymob.baseUrl')!;
    this.apiKey = config.get<string>('payments.paymob.apiKey') || undefined;
    this.secretKey = config.get<string>('payments.paymob.secretKey') || undefined;
    this.publicKey = config.get<string>('payments.paymob.publicKey') || undefined;
    this.integrationIdCard = config.get<string>('payments.paymob.integrationIdCard') || undefined;
    this.hmacSecret = config.get<string>('payments.paymob.hmacSecret') || undefined;
    this.isConfigured = Boolean(this.secretKey && this.publicKey && this.integrationIdCard && this.hmacSecret);

    if (!this.isConfigured) {
      this.logger.warn(
        'PAYMOB_SECRET_KEY/PAYMOB_PUBLIC_KEY/PAYMOB_INTEGRATION_ID_CARD/PAYMOB_HMAC_SECRET ناقصين — الدفع بالبطاقة هيرفض بوضوح لحد ما تتظبط',
      );
    }
  }

  private async legacyAuthToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey }),
    });
    if (!res.ok) {
      throw new Error(`Paymob legacy auth فشل: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as PaymobAuthTokenResponse;
    return data.token;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment (مش مُعدّة)');
    }
    try {
      const res = await fetch(`${this.baseUrl}/v1/intention/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${this.secretKey}` },
        body: JSON.stringify({
          amount: input.amountCents,
          currency: input.currencyCode,
          payment_methods: [Number(this.integrationIdCard)],
          items: [{ name: `طلب ${input.orderNumber}`, amount: input.amountCents, description: `baytak — ${input.orderNumber}`, quantity: 1 }],
          billing_data: {
            first_name: input.customerFirstName || 'NA',
            last_name: input.customerLastName || 'NA',
            email: input.customerEmail,
            phone_number: input.customerPhone,
            apartment: 'NA',
            floor: 'NA',
            street: 'NA',
            building: 'NA',
            city: 'NA',
            country: 'EG',
            state: 'NA',
          },
          // special_reference = مرجعنا الداخلي (payments.id) — ده اللي بيرجع في merchant_order_id
          // جوّه رد الـwebhook (نفس مبدأ الـflow القديم بالحرف، موثّق في ADR-0013).
          special_reference: input.paymentId,
        }),
      });
      if (!res.ok) {
        throw new Error(`Paymob intention creation فشل: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as PaymobIntentionResponse;
      const checkoutUrl = `${this.baseUrl}/unifiedcheckout/?publicKey=${this.publicKey}&clientSecret=${data.client_secret}`;
      return { kind: 'redirect', checkoutUrl, providerReference: data.client_secret };
    } catch (err) {
      this.logger.error('فشل إنشاء عملية دفع Paymob', err instanceof Error ? err.stack : err);
      throw err;
    }
  }

  /**
   * حساب HMAC-SHA512 مطابق حرفياً لـ"HMAC Calculation" الموثّق في Paymob Accept API — عقد
   * الـwebhook نفسه بغض النظر عن الـflow اللي بدأ الدفع (Intention أو القديم)، صفر تغيير هنا.
   */
  private computeHmac(obj: PaymobTransactionObj, secret: string): string {
    const fields = [
      String(obj.amount_cents),
      obj.created_at,
      obj.currency,
      String(obj.error_occured),
      String(obj.has_parent_transaction),
      String(obj.id),
      String(obj.integration_id),
      String(obj.is_3d_secure),
      String(obj.is_auth),
      String(obj.is_capture),
      String(obj.is_refunded),
      String(obj.is_standalone_payment),
      String(obj.is_voided),
      String(obj.order.id),
      String(obj.owner),
      String(obj.pending),
      obj.source_data?.pan ?? '',
      obj.source_data?.sub_type ?? '',
      obj.source_data?.type ?? '',
      String(obj.success),
    ].join('');

    return createHmac('sha512', secret).update(fields).digest('hex');
  }

  verifyWebhook(rawPayload: Record<string, unknown>, signature: string | undefined): WebhookVerificationResult {
    const payload = rawPayload as unknown as PaymobWebhookPayload;
    const obj = payload?.obj;

    const failResult = (reason: string): WebhookVerificationResult => ({
      signatureValid: false,
      externalEventId: obj ? String(obj.id) : 'unknown',
      eventType: payload?.type ?? 'unknown',
      paymentId: obj?.order?.merchant_order_id ?? null,
      succeeded: false,
      amountCents: obj?.amount_cents ?? null,
      gatewayTransactionId: obj ? String(obj.id) : 'unknown',
      failureReason: reason,
    });

    if (!this.isConfigured || !this.hmacSecret) {
      return failResult('لا توجد بوابة دفع مُعدّة');
    }
    if (!obj || !signature) {
      return failResult('حمولة webhook غير صالحة — obj أو hmac مفقود');
    }

    const expectedHmac = this.computeHmac(obj, this.hmacSecret);
    const expectedBuf = Buffer.from(expectedHmac, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const signatureValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

    if (!signatureValid) {
      return failResult('توقيع HMAC غير صحيح — ممكن يكون الحدث ده مزوّر');
    }

    return {
      signatureValid: true,
      externalEventId: String(obj.id),
      eventType: payload.type ?? 'TRANSACTION',
      paymentId: obj.order.merchant_order_id ?? null,
      succeeded: obj.success === true && obj.error_occured !== true,
      amountCents: obj.amount_cents,
      gatewayTransactionId: String(obj.id),
      failureReason: obj.success ? null : (obj.data?.message ?? 'فشلت عملية الدفع عند البوابة'),
    };
  }

  private mapStatus(t: PaymobTransactionInquiryResponse): PaymentProviderStatus {
    if (t.is_refunded) return PaymentProviderStatus.REFUNDED;
    if (t.is_voided) return PaymentProviderStatus.CANCELLED;
    if (t.pending) return PaymentProviderStatus.PROCESSING;
    return t.success ? PaymentProviderStatus.SUCCEEDED : PaymentProviderStatus.FAILED;
  }

  async getPaymentStatus(providerReference: string): Promise<PaymentStatusResult> {
    if (!this.isConfigured || !this.apiKey) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'getPaymentStatus (مش مُعدّة)');
    }
    const authToken = await this.legacyAuthToken();
    const res = await fetch(`${this.baseUrl}/api/acceptance/transactions/${providerReference}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
      throw new Error(`Paymob transaction inquiry فشل: ${res.status} ${await res.text()}`);
    }
    const t = (await res.json()) as PaymobTransactionInquiryResponse;
    return { status: this.mapStatus(t), amountCents: t.amount_cents, succeeded: t.success === true };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'refund (مش مُعدّة)');
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/acceptance/void_refund/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${this.secretKey}` },
        body: JSON.stringify({ transaction_id: Number(input.providerReference), amount_cents: input.amountCents }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; id?: number; data?: { message?: string } };
      if (!res.ok || body.success === false) {
        return {
          succeeded: false,
          providerRefundId: null,
          status: PaymentProviderStatus.FAILED,
          failureReason: body.data?.message ?? `Paymob refund رفض: ${res.status}`,
        };
      }
      return {
        succeeded: true,
        providerRefundId: body.id ? String(body.id) : null,
        status: PaymentProviderStatus.REFUNDED,
        failureReason: null,
      };
    } catch (err) {
      this.logger.error('فشل استرداد Paymob', err instanceof Error ? err.stack : err);
      return {
        succeeded: false,
        providerRefundId: null,
        status: PaymentProviderStatus.FAILED,
        failureReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async void(providerReference: string): Promise<VoidResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'void (مش مُعدّة)');
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/acceptance/void_refund/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${this.secretKey}` },
        body: JSON.stringify({ transaction_id: Number(providerReference) }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { message?: string } };
      if (!res.ok || body.success === false) {
        return { succeeded: false, failureReason: body.data?.message ?? `Paymob void رفض: ${res.status}` };
      }
      return { succeeded: true, failureReason: null };
    } catch (err) {
      this.logger.error('فشل إلغاء (void) Paymob', err instanceof Error ? err.stack : err);
      return { succeeded: false, failureReason: err instanceof Error ? err.message : String(err) };
    }
  }

  async capture(providerReference: string, amountCents: number): Promise<CaptureResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'capture (مش مُعدّة)');
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/acceptance/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${this.secretKey}` },
        body: JSON.stringify({ transaction_id: Number(providerReference), amount_cents: amountCents }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { message?: string } };
      if (!res.ok || body.success === false) {
        return { succeeded: false, failureReason: body.data?.message ?? `Paymob capture رفض: ${res.status}` };
      }
      return { succeeded: true, failureReason: null };
    } catch (err) {
      this.logger.error('فشل تأكيد تحصيل (capture) Paymob', err instanceof Error ? err.stack : err);
      return { succeeded: false, failureReason: err instanceof Error ? err.message : String(err) };
    }
  }

  async reconcile(providerReference: string): Promise<ReconcileResult> {
    const status = await this.getPaymentStatus(providerReference);
    return { status: status.status, amountCents: status.amountCents };
  }
}
