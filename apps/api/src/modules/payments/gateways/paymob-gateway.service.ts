import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException, ErrorCode } from '../../../common/exceptions/api.exception';
import {
  CreateCardPaymentInput,
  CreateCardPaymentResult,
  PaymentGateway,
  WebhookVerificationResult,
} from './payment-gateway.interface';

interface PaymobAuthResponse {
  token: string;
}

interface PaymobOrderResponse {
  id: number;
}

interface PaymobPaymentKeyResponse {
  token: string;
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

/**
 * تكامل حقيقي مع Paymob Accept (أشهر بوابة دفع مصرية، مطابقة لعملة EGP اللي كل أسعار النظام
 * بيها بالفعل) — مبني حرفياً على العقد الموثّق لـ Accept API v1: مصادقة → تسجيل طلب → طلب
 * مفتاح دفع → iframe مستضاف، وHMAC-SHA512 للتحقق من ردود الـ webhook (نفس الترتيب والحقول
 * الموثّقة في Paymob HMAC Calculation، شرح كامل تحت). محتاج فعلياً حساب Paymob حقيقي
 * (PAYMOB_API_KEY, PAYMOB_INTEGRATION_ID_CARD, PAYMOB_IFRAME_ID, PAYMOB_HMAC_SECRET) — راجع
 * docs/03-external-integrations.md لخطوات الحصول عليهم بالظبط ومكان كل قيمة.
 */
@Injectable()
export class PaymobGatewayService implements PaymentGateway {
  readonly providerName = 'paymob';
  readonly isConfigured: boolean;
  private readonly logger = new Logger('PaymentGateway(paymob)');

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly integrationIdCard: string | undefined;
  private readonly iframeId: string | undefined;
  private readonly hmacSecret: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('payments.paymob.baseUrl')!;
    this.apiKey = config.get<string>('payments.paymob.apiKey') || undefined;
    this.integrationIdCard = config.get<string>('payments.paymob.integrationIdCard') || undefined;
    this.iframeId = config.get<string>('payments.paymob.iframeId') || undefined;
    this.hmacSecret = config.get<string>('payments.paymob.hmacSecret') || undefined;
    this.isConfigured = Boolean(this.apiKey && this.integrationIdCard && this.iframeId && this.hmacSecret);

    if (!this.isConfigured) {
      this.logger.warn(
        'PAYMOB_API_KEY/PAYMOB_INTEGRATION_ID_CARD/PAYMOB_IFRAME_ID/PAYMOB_HMAC_SECRET ناقصين — الدفع بالبطاقة هيرفض بوضوح لحد ما تتظبط',
      );
    }
  }

  private async authenticate(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey }),
    });
    if (!res.ok) {
      throw new Error(`Paymob auth فشل: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as PaymobAuthResponse;
    return data.token;
  }

  private async registerOrder(authToken: string, input: CreateCardPaymentInput): Promise<number> {
    const res = await fetch(`${this.baseUrl}/api/ecommerce/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: input.amountCents,
        currency: input.currencyCode,
        // merchant_order_id لازم يكون فريد عند Paymob — بنستخدم payment id بتاعنا (UUID) مباشرة،
        // ده اللي بيربط رد الـ webhook بالدفعة الصح من غير أي حالة/جلسة وسيطة.
        merchant_order_id: input.paymentId,
        items: [],
      }),
    });
    if (!res.ok) {
      throw new Error(`Paymob order registration فشل: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as PaymobOrderResponse;
    return data.id;
  }

  private async requestPaymentKey(authToken: string, paymobOrderId: number, input: CreateCardPaymentInput): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/acceptance/payment_keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: input.amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        currency: input.currencyCode,
        integration_id: Number(this.integrationIdCard),
        billing_data: {
          // Paymob بيطلب كل الحقول دي إجبارياً حتى لو مش متوفرة فعلياً — "NA" fallback موثّق
          // ومقبول رسمياً في توثيقهم لأي حقل عنوان مش عندنا (مفيش عناوين فوترة منفصلة في baytak).
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
          postal_code: 'NA',
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Paymob payment key request فشل: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as PaymobPaymentKeyResponse;
    return data.token;
  }

  async createCardPayment(input: CreateCardPaymentInput): Promise<CreateCardPaymentResult> {
    if (!this.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بالبطاقة مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      const authToken = await this.authenticate();
      const paymobOrderId = await this.registerOrder(authToken, input);
      const paymentKey = await this.requestPaymentKey(authToken, paymobOrderId, input);
      return {
        redirectUrl: `${this.baseUrl}/api/acceptance/iframes/${this.iframeId}?payment_token=${paymentKey}`,
        gatewayOrderId: String(paymobOrderId),
      };
    } catch (err) {
      this.logger.error('فشل إنشاء عملية دفع Paymob', err instanceof Error ? err.stack : err);
      throw new ApiException(ErrorCode.PAY_001, 'فشل الاتصال ببوابة الدفع، حاول تاني', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * حساب HMAC-SHA512 مطابق حرفياً لـ"HMAC Calculation" الموثّق في Paymob Accept API —
   * concatenation بترتيب ثابت (مش أبجدي، ده بالظبط ترتيبهم الرسمي) لقيم الحقول دي كنصوص خام
   * (booleans كـ"true"/"false" حرفياً)، من غير أي فاصل بين القيم، وبعدين HMAC-SHA512 hex
   * بالـ secret بتاع الـ integration (مختلف عن الـ API key نفسه — قيمة منفصلة في لوحة Paymob).
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

  verifyAndParseWebhook(rawPayload: Record<string, unknown>, hmacFromQuery: string | undefined): WebhookVerificationResult {
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
    if (!obj || !hmacFromQuery) {
      return failResult('حمولة webhook غير صالحة — obj أو hmac مفقود');
    }

    const expectedHmac = this.computeHmac(obj, this.hmacSecret);
    // مقارنة زمن ثابت (timing-safe) — مقارنة == عادية بتسرّب معلومة عن مدى تطابق التوقيع
    // عبر فرق التوقيت، وده بالظبط نوع الثغرة اللي timingSafeEqual مصمم يمنعه.
    const expectedBuf = Buffer.from(expectedHmac, 'hex');
    const actualBuf = Buffer.from(hmacFromQuery, 'hex');
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
}
