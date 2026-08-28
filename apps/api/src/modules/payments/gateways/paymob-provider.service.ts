import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CaptureResult,
  CardSaveWebhookResult,
  ChargeTokenInput,
  ChargeTokenResult,
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
import { SettingsService } from '../../settings/settings.service';
import { SETTING_UPDATED_EVENT, SettingUpdatedEvent } from '../../../common/events/setting-updated.event';

const PAYMOB_SETTING_PREFIX = 'payments.paymob.';

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

interface PaymobEcommerceOrderResponse {
  id: number;
}

interface PaymobPaymentKeyResponse {
  token: string;
}

interface PaymobPayResponse {
  id?: number;
  success?: boolean;
  pending?: boolean;
  data?: { message?: string };
}

// حدث "حفظ كارت" (Save Card / Token) — حمولة مختلفة تمامًا عن TRANSACTION، بيوصل منفصل بعد نجاح
// دفع فيه العميل وافق يحفظ كارته (Unified Checkout بتعرض الخيار ده تلقائيًا لو الـintegration
// مُعدّة تسمح بالتوكينة عند Paymob — صفر تحكم منا في ظهور الخيار نفسه).
interface PaymobTokenWebhookObj {
  id: number;
  token: string;
  masked_pan?: string;
  card_subtype?: string;
  merchant_id?: number;
  created_at?: string;
  email?: string;
  order_id?: number;
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
export class PaymobProvider implements PaymentProvider, OnModuleInit {
  readonly providerKey = 'paymob';
  isConfigured = false;
  readonly supportsRefund = true;
  readonly supportsVoid = true;
  readonly supportsCapture = true;
  supportsTokenization = false;
  private readonly logger = new Logger('PaymentProvider(paymob)');

  private baseUrl: string;
  private apiKey: string | undefined;
  private secretKey: string | undefined;
  private publicKey: string | undefined;
  private integrationIdCard: string | undefined;
  // docs/08 §19 بند 15 — Mobile Wallet (Vodafone Cash/إلخ) عبر نفس حساب Paymob التاجر، اختياري
  // بالكامل. لو موجودة، بتتضاف لقايمة payment_methods جنب الكارت في createPayment() — Paymob's
  // Unified Checkout بيعرض خيار المحفظة تلقائيًا في نفس الصفحة، صفر منطق backend إضافي مطلوب.
  private integrationIdMobileWallet: string | undefined;
  private hmacSecret: string | undefined;
  private readonly envFallback: Record<string, string | undefined>;

  getConfigurationStatus(): { configured: boolean; missingFields: string[] } {
    const required: [string, string | undefined][] = [
      ['API Key', this.apiKey],
      ['Secret Key', this.secretKey],
      ['Public Key', this.publicKey],
      ['Card Integration ID', this.integrationIdCard],
      ['HMAC Secret', this.hmacSecret],
    ];
    return {
      configured: this.isConfigured,
      missingFields: required.filter(([, value]) => !value?.trim()).map(([label]) => label),
    };
  }

  constructor(config: ConfigService, @Optional() private readonly settingsService?: SettingsService) {
    this.envFallback = {
      baseUrl: config.get<string>('payments.paymob.baseUrl'),
      apiKey: config.get<string>('payments.paymob.apiKey') || undefined,
      secretKey: config.get<string>('payments.paymob.secretKey') || undefined,
      publicKey: config.get<string>('payments.paymob.publicKey') || undefined,
      integrationIdCard: config.get<string>('payments.paymob.integrationIdCard') || undefined,
      integrationIdMobileWallet: config.get<string>('payments.paymob.integrationIdMobileWallet') || undefined,
      hmacSecret: config.get<string>('payments.paymob.hmacSecret') || undefined,
    };
    this.baseUrl = this.envFallback.baseUrl || 'https://accept.paymob.com';
    this.applyConfiguration(this.envFallback);
  }

  async onModuleInit(): Promise<void> {
    if (this.settingsService) await this.reloadFromSettings();
  }

  @OnEvent(SETTING_UPDATED_EVENT)
  async handleSettingUpdated(event: SettingUpdatedEvent): Promise<void> {
    if (!event.key.startsWith(PAYMOB_SETTING_PREFIX)) return;
    await this.reloadFromSettings();
  }

  private applyConfiguration(values: Record<string, string | undefined>): void {
    this.baseUrl = values.baseUrl || 'https://accept.paymob.com';
    this.apiKey = values.apiKey || undefined;
    this.secretKey = values.secretKey || undefined;
    this.publicKey = values.publicKey || undefined;
    this.integrationIdCard = values.integrationIdCard || undefined;
    this.integrationIdMobileWallet = values.integrationIdMobileWallet || undefined;
    this.hmacSecret = values.hmacSecret || undefined;
    this.isConfigured = Boolean(
      this.apiKey && this.secretKey && this.publicKey && this.integrationIdCard && this.hmacSecret,
    );
    this.supportsTokenization = this.isConfigured;

    if (!this.isConfigured) {
      this.logger.warn(
        'إعدادات Paymob الأساسية ناقصة — الدفع بالبطاقة هيرفض بوضوح لحد ما تتظبط',
      );
    }
  }

  private async reloadFromSettings(): Promise<void> {
    if (!this.settingsService) return;
    const [
      baseUrl, apiKey, secretKey, publicKey, integrationIdCard, integrationIdMobileWallet, hmacSecret,
    ] = await Promise.all([
      this.settingsService.getString('payments.paymob.base_url', this.envFallback.baseUrl || 'https://accept.paymob.com'),
      this.settingsService.getSecret('payments.paymob.api_key', this.envFallback.apiKey || ''),
      this.settingsService.getSecret('payments.paymob.secret_key', this.envFallback.secretKey || ''),
      this.settingsService.getString('payments.paymob.public_key', this.envFallback.publicKey || ''),
      this.settingsService.getString('payments.paymob.integration_id_card', this.envFallback.integrationIdCard || ''),
      this.settingsService.getString('payments.paymob.integration_id_mobile_wallet', this.envFallback.integrationIdMobileWallet || ''),
      this.settingsService.getSecret('payments.paymob.hmac_secret', this.envFallback.hmacSecret || ''),
    ]);
    this.applyConfiguration({
      baseUrl, apiKey, secretKey, publicKey, integrationIdCard, integrationIdMobileWallet, hmacSecret,
    });
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
          payment_methods: [
            Number(this.integrationIdCard),
            ...(this.integrationIdMobileWallet ? [Number(this.integrationIdMobileWallet)] : []),
          ],
          items: [{ name: `طلب ${input.orderNumber}`, amount: input.amountCents, description: `أسطى — ${input.orderNumber}`, quantity: 1 }],
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

  /**
   * تحصيل شغل إضافي معتمد بوسيلة دفع محفوظة (docs/08 §21) — merchant-initiated (MOTO)، بلا
   * redirect/تفاعل عميل. تسلسل Paymob الكلاسيكي المعروف (auth_token → ecommerce order →
   * payment_key → pay بـsource.subtype=TOKEN)، مختلف عمداً عن Intention API المستخدمة في
   * createPayment() فوق (الـIntention مبنية لـredirect/checkout، مش لشحن توكن محفوظ سيرفر-side).
   * **تنبيه صريح (نفس نمط توثيق باقي الملف ده)**: التسلسل ده مبني على أفضل معرفة موثّقة لـPaymob
   * بلا وصول لـdocs.paymob.com (محجوب هنا) — لازم يتأكد بمعاملة اختبار حقيقية واحدة على حساب
   * Paymob فعلي قبل تفعيل الحفظ في الإنتاج.
   */
  async chargeToken(input: ChargeTokenInput): Promise<ChargeTokenResult> {
    if (!this.isConfigured || !this.apiKey) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'chargeToken (مش مُعدّة)');
    }
    try {
      const authToken = await this.legacyAuthToken();

      const orderRes = await fetch(`${this.baseUrl}/api/ecommerce/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          delivery_needed: false,
          amount_cents: input.amountCents,
          currency: input.currencyCode,
          merchant_order_id: input.paymentId, // نفس دور special_reference في createPayment() — بيوصل في merchant_order_id وقت webhook التأكيد
          items: [],
        }),
      });
      if (!orderRes.ok) {
        throw new Error(`Paymob ecommerce order فشل: ${orderRes.status} ${await orderRes.text()}`);
      }
      const order = (await orderRes.json()) as PaymobEcommerceOrderResponse;

      const keyRes = await fetch(`${this.baseUrl}/api/acceptance/payment_keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          amount_cents: input.amountCents,
          expiration: 3600,
          order_id: order.id,
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
          currency: input.currencyCode,
          integration_id: Number(this.integrationIdCard),
        }),
      });
      if (!keyRes.ok) {
        throw new Error(`Paymob payment key فشل: ${keyRes.status} ${await keyRes.text()}`);
      }
      const paymentKey = (await keyRes.json()) as PaymobPaymentKeyResponse;

      const payRes = await fetch(`${this.baseUrl}/api/acceptance/payments/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { identifier: input.providerToken, subtype: 'TOKEN' },
          payment_token: paymentKey.token,
        }),
      });
      const body = (await payRes.json().catch(() => ({}))) as PaymobPayResponse;
      if (!payRes.ok || body.success === false) {
        return {
          succeeded: false,
          providerReference: body.id ? String(body.id) : null,
          failureReason: body.data?.message ?? `Paymob token charge رفض: ${payRes.status}`,
        };
      }
      return { succeeded: body.success === true, providerReference: body.id ? String(body.id) : null, failureReason: null };
    } catch (err) {
      this.logger.error('فشل تحصيل بوسيلة دفع محفوظة (chargeToken) Paymob', err instanceof Error ? err.stack : err);
      return { succeeded: false, providerReference: null, failureReason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * حساب HMAC لحدث "حفظ كارت" (TOKEN) — ترتيب حقول مختلف عن computeHmac() فوق (شكل حمولة مختلف
   * تمامًا). **الترتيب هنا أفضل معرفة موثّقة بلا وصول لـdocs.paymob.com، غير مؤكد ضد حساب حقيقي —
   * لازم تأكيد بمعاملة اختبار واحدة قبل تفعيل الحفظ في الإنتاج** (نفس التنبيه فوق).
   */
  verifyCardSaveWebhook(rawPayload: Record<string, unknown>, signature: string | undefined): CardSaveWebhookResult | null {
    const payload = rawPayload as { type?: string; obj?: PaymobTokenWebhookObj };
    if (payload?.type !== 'TOKEN' || !payload.obj?.token) {
      return null; // مش حدث حفظ كارت أصلاً — الكولر يرجع لـverifyWebhook العادي
    }
    const obj = payload.obj;

    const failResult = (reason: string): CardSaveWebhookResult => {
      this.logger.warn(`حدث حفظ كارت اترفض: ${reason}`);
      return { signatureValid: false, externalEventId: String(obj.id), providerToken: '', maskedPan: null, cardBrand: null, customerEmail: null };
    };

    if (!this.isConfigured || !this.hmacSecret || !signature) {
      return failResult('لا توجد بوابة دفع مُعدّة');
    }

    const fields = [
      obj.card_subtype ?? '',
      obj.created_at ?? '',
      obj.email ?? '',
      String(obj.id),
      obj.masked_pan ?? '',
      String(obj.merchant_id ?? ''),
      String(obj.order_id ?? ''),
    ].join('');
    const expectedHmac = createHmac('sha512', this.hmacSecret).update(fields).digest('hex');
    const expectedBuf = Buffer.from(expectedHmac, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    const signatureValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

    if (!signatureValid) {
      return failResult('توقيع HMAC غير صحيح لحدث حفظ الكارت');
    }

    return {
      signatureValid: true,
      externalEventId: String(obj.id),
      providerToken: obj.token,
      maskedPan: obj.masked_pan ?? null,
      cardBrand: obj.card_subtype ?? null,
      customerEmail: obj.email ?? null,
    };
  }
}
