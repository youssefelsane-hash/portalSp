import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ApiException, ErrorCode } from '../../../common/exceptions/api.exception';
import {
  CreateFawryReferenceInput,
  CreateFawryReferenceResult,
  FawryGateway,
  FawryWebhookVerificationResult,
} from './fawry-gateway.interface';

interface FawryChargeResponse {
  referenceNumber?: string;
  fawryRefNumber?: string;
  merchantRefNumber?: string;
  statusCode?: number;
  statusDescription?: string;
}

interface FawryWebhookPayload {
  requestId?: string;
  fawryRefNumber?: string;
  merchantRefNumber?: string;
  paymentAmount?: number | string;
  orderAmount?: number | string;
  orderStatus?: string;
  paymentMethod?: string;
  paymentTime?: number;
  signature?: string;
}

/**
 * تكامل مع "FawryPay" — تحديداً طريقة الدفع بكود مرجعي ("ادفع في أقرب فوري"): العميل بياخد
 * referenceNumber وبيدفعه كاش فعلي في أي منفذ فوري (أوسع شبكة دفع كاش في مصر)، والتأكيد بييجي
 * عبر webhook async زي الدفع بالبطاقة بالظبط — مفيش أي تسوية بتحصل هنا خالص.
 *
 * ⚠️ تحذير مهم: الكود ده مبني على أفضل فهم موثّق لعقد "FawryPay Server-to-Server Charge API"
 * (endpoint المسار، أسماء الحقول الأساسية، ومنطق حساب SHA-256 للتوقيع) — **لسه محتاج تحقق فعلي
 * ضد sandbox حقيقي قبل أي استخدام إنتاجي**. الجزء الأكثر عرضة للخطأ تحديداً هو *ترتيب* حقول
 * التوقيع في computeChargeSignature/computeWebhookSignature — لو رجع الرد "توقيع غير صحيح"
 * (statusCode مش 200) أو webhook رفض بتوقيع خاطئ، أول حاجة تتأكد منها هي الترتيب ده مقابل
 * التوثيق الرسمي الحالي من FawryPay (Merchant Dashboard → Integration → API Docs)، مش أي حاجة
 * تانية في الكود. تفاصيل الحصول على المفاتيح وخطوات التحقق: docs/03-external-integrations.md.
 */
@Injectable()
export class FawryGatewayService implements FawryGateway {
  readonly providerName = 'fawry';
  readonly isConfigured: boolean;
  private readonly logger = new Logger('PaymentGateway(fawry)');

  private readonly baseUrl: string;
  private readonly merchantCode: string | undefined;
  private readonly secureKey: string | undefined;
  private readonly referenceExpiryHours: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('payments.fawry.baseUrl')!;
    this.merchantCode = config.get<string>('payments.fawry.merchantCode') || undefined;
    this.secureKey = config.get<string>('payments.fawry.secureKey') || undefined;
    this.referenceExpiryHours = config.get<number>('payments.fawry.referenceExpiryHours') ?? 72;
    this.isConfigured = Boolean(this.merchantCode && this.secureKey);

    if (!this.isConfigured) {
      this.logger.warn('FAWRY_MERCHANT_CODE/FAWRY_SECURE_KEY ناقصين — الدفع بكود فوري هيرفض بوضوح لحد ما تتظبط');
    }
  }

  private formatAmount(amountCents: number): string {
    return (amountCents / 100).toFixed(2);
  }

  /**
   * توقيع طلب الشحن (charge request) — بيتبعت مع الـ body عشان FawryPay تتأكد إن الطلب فعلاً
   * جاي مننا. الترتيب هنا (merchantCode → merchantRefNum → paymentMethod → amount → itemId+quantity+price
   * لكل عنصر بالترتيب → secureKey) مطابق لأكتر نسخة موثّقة شيوعاً من "Charge Request Signature"،
   * بس **يستاهل تحقق مباشر** (راجع التحذير فوق).
   */
  private computeChargeSignature(input: CreateFawryReferenceInput, amountStr: string): string {
    const parts = [
      this.merchantCode!,
      input.paymentId,
      'PAYATFAWRY',
      amountStr,
      // عنصر شحن واحد بس (الطلب كوحدة واحدة) — itemId ثابت "1"، الكمية 1، والسعر = المبلغ الكلي.
      '1',
      '1',
      amountStr,
      this.secureKey!,
    ];
    return createHash('sha256').update(parts.join('')).digest('hex');
  }

  async createReference(input: CreateFawryReferenceInput): Promise<CreateFawryReferenceResult> {
    if (!this.isConfigured) {
      throw new ApiException(
        ErrorCode.PAY_001,
        'الدفع بكود فوري مش متاح دلوقتي — جرّب الدفع بالمحفظة أو الكاش أو الكارت',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const amountStr = this.formatAmount(input.amountCents);
    const signature = this.computeChargeSignature(input, amountStr);

    try {
      const res = await fetch(`${this.baseUrl}/ECommerceWeb/Fawry/payments/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantCode: this.merchantCode,
          merchantRefNum: input.paymentId,
          customerMobile: input.customerMobile,
          customerEmail: input.customerEmail,
          customerName: input.customerName,
          amount: Number(amountStr),
          currencyCode: 'EGP',
          description: `طلب أسطى ${input.orderNumber}`,
          paymentMethod: 'PAYATFAWRY',
          chargeItems: [{ itemId: '1', description: `طلب ${input.orderNumber}`, price: Number(amountStr), quantity: 1 }],
          chargeExpiry: this.referenceExpiryHours * 60,
          signature,
        }),
      });

      if (!res.ok) {
        throw new Error(`Fawry charge request فشل: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as FawryChargeResponse;
      if (data.statusCode !== undefined && data.statusCode !== 200) {
        throw new Error(`Fawry رفض الطلب: ${data.statusCode} ${data.statusDescription ?? ''}`);
      }
      const referenceNumber = data.referenceNumber ?? data.fawryRefNumber;
      if (!referenceNumber) {
        throw new Error('Fawry رجع رد من غير referenceNumber');
      }

      return {
        referenceNumber,
        expiresAt: new Date(Date.now() + this.referenceExpiryHours * 60 * 60 * 1000),
        gatewayOrderId: referenceNumber,
      };
    } catch (err) {
      this.logger.error('فشل إنشاء كود مرجعي Fawry', err instanceof Error ? err.stack : err);
      throw new ApiException(ErrorCode.PAY_001, 'فشل الاتصال ببوابة الدفع، حاول تاني', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * توقيع webhook التأكيد — الترتيب هنا (fawryRefNumber → merchantRefNumber → paymentAmount →
   * orderAmount → orderStatus → paymentMethod → secureKey) **يستاهل نفس التحقق** الموثّق فوق.
   */
  private computeWebhookSignature(payload: FawryWebhookPayload): string {
    const parts = [
      payload.fawryRefNumber ?? '',
      payload.merchantRefNumber ?? '',
      payload.paymentAmount !== undefined ? String(payload.paymentAmount) : '',
      payload.orderAmount !== undefined ? String(payload.orderAmount) : '',
      payload.orderStatus ?? '',
      payload.paymentMethod ?? '',
      this.secureKey ?? '',
    ];
    return createHash('sha256').update(parts.join('')).digest('hex');
  }

  verifyAndParseWebhook(rawPayload: Record<string, unknown>): FawryWebhookVerificationResult {
    const payload = rawPayload as FawryWebhookPayload;

    const failResult = (reason: string): FawryWebhookVerificationResult => ({
      signatureValid: false,
      externalEventId: payload.fawryRefNumber ?? payload.requestId ?? 'unknown',
      eventType: 'FawryNotification',
      paymentId: payload.merchantRefNumber ?? null,
      succeeded: false,
      amountCents: payload.paymentAmount !== undefined ? Math.round(Number(payload.paymentAmount) * 100) : null,
      gatewayTransactionId: payload.fawryRefNumber ?? 'unknown',
      failureReason: reason,
    });

    if (!this.isConfigured || !this.secureKey) {
      return failResult('لا توجد بوابة Fawry مُعدّة');
    }
    if (!payload.signature || !payload.fawryRefNumber || !payload.merchantRefNumber) {
      return failResult('حمولة webhook غير صالحة — حقول أساسية مفقودة');
    }

    // مقارنة زمن ثابت (timing-safe) — نفس منطق paymob-gateway.service.ts بالحرف.
    const expectedBuf = Buffer.from(this.computeWebhookSignature(payload), 'hex');
    const actualBuf = Buffer.from(payload.signature.toLowerCase(), 'hex');
    const signatureValid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

    if (!signatureValid) {
      return failResult('توقيع غير صحيح — ممكن يكون الحدث ده مزوّر');
    }

    return {
      signatureValid: true,
      externalEventId: payload.fawryRefNumber,
      eventType: 'FawryNotification',
      paymentId: payload.merchantRefNumber,
      succeeded: payload.orderStatus === 'PAID',
      amountCents: payload.paymentAmount !== undefined ? Math.round(Number(payload.paymentAmount) * 100) : null,
      gatewayTransactionId: payload.fawryRefNumber,
      failureReason: payload.orderStatus !== 'PAID' ? `orderStatus=${payload.orderStatus ?? 'unknown'}` : null,
    };
  }
}
