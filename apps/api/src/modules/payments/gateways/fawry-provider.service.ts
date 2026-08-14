import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { FAWRY_GATEWAY, FawryGateway } from './fawry-gateway.interface';
import {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentOperationNotSupportedError,
  PaymentProvider,
  PaymentStatusResult,
  ReconcileResult,
  RefundInput,
  RefundResult,
  VoidResult,
  WebhookVerificationResult,
} from './payment-provider.interface';

const FAWRY_ENABLED_FALLBACK = false;

/**
 * غلاف يوحّد FawryGatewayService (interface منفصل تاريخيًا، شكل رد مختلف — reference code مش
 * redirect) تحت PaymentProvider العام (ADR-0013). المنطق الداخلي (توقيع/webhook) زي ما هو
 * بالحرف — Fawry **مؤجّلة التطوير الفعلي** حسب توجيه المالك (2026-08-14: "مش أولوية V1")، بس
 * **مش محذوفة** (خطر regression بلا داعي). `payments.fawry_enabled` (افتراضي false) بيتحكم في
 * ظهورها كطريقة دفع فعلية — تعطيل صريح خلف إعداد، مش بس "env vars ناقصة".
 */
@Injectable()
export class FawryProvider implements PaymentProvider {
  readonly providerKey = 'fawry';
  readonly supportsRefund = false; // مفيش refund API موثّق لكود فوري المرجعي — wallet credit fallback
  readonly supportsVoid = false;
  readonly supportsCapture = false;

  constructor(
    @Inject(FAWRY_GATEWAY) private readonly fawryGateway: FawryGateway,
    private readonly settingsService: SettingsService,
  ) {}

  get isConfigured(): boolean {
    return this.fawryGateway.isConfigured;
  }

  private async assertEnabled(): Promise<void> {
    const enabled = await this.settingsService.getBoolean('payments.fawry_enabled', FAWRY_ENABLED_FALLBACK);
    if (!enabled) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment — Fawry معطّل حاليًا (payments.fawry_enabled)');
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    await this.assertEnabled();
    const result = await this.fawryGateway.createReference({
      paymentId: input.paymentId,
      orderNumber: input.orderNumber,
      amountCents: input.amountCents,
      customerName: `${input.customerFirstName} ${input.customerLastName}`.trim(),
      customerEmail: input.customerEmail,
      customerMobile: input.customerPhone,
    });
    return {
      kind: 'reference',
      referenceCode: result.referenceNumber,
      instructionsAr: `اذهب لأقرب منفذ فوري وادفع الكود ${result.referenceNumber} كاش قبل ${result.expiresAt.toLocaleString('ar-EG')}.`,
      providerReference: result.gatewayOrderId,
      expiresAt: result.expiresAt,
    };
  }

  verifyWebhook(rawPayload: Record<string, unknown>): WebhookVerificationResult {
    const r = this.fawryGateway.verifyAndParseWebhook(rawPayload);
    return {
      signatureValid: r.signatureValid,
      externalEventId: r.externalEventId,
      eventType: r.eventType,
      paymentId: r.paymentId,
      succeeded: r.succeeded,
      amountCents: r.amountCents,
      gatewayTransactionId: r.gatewayTransactionId,
      failureReason: r.failureReason,
    };
  }

  getPaymentStatus(_providerReference: string): Promise<PaymentStatusResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'getPaymentStatus');
  }

  refund(_input: RefundInput): Promise<RefundResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'refund');
  }

  void(_providerReference: string): Promise<VoidResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'void');
  }

  capture(_providerReference: string, _amountCents: number): Promise<CaptureResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'capture');
  }

  reconcile(_providerReference: string): Promise<ReconcileResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'reconcile');
  }
}
