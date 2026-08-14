import { Injectable } from '@nestjs/common';
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

/**
 * كاش — بلا بوابة خارجية خالص (ADR-0013). التسجيل الفعلي للتحصيل بيحصل مباشرة في
 * PaymentsService.collectCash()، مش عبر createPayment() هنا (الكاش مالوش "بدء عملية" حقيقي
 * تتنادى له بوابة). موجودة أساسًا عشان PaymentProviderRegistry يقدر يرجّعها لـrefundOrder()
 * كـ`supportsRefund=false` → fallback واضح لـwallet credit، نفس السلوك الحالي بالضبط.
 */
@Injectable()
export class CashProvider implements PaymentProvider {
  readonly providerKey = 'cash';
  readonly isConfigured = true;
  readonly supportsRefund = false;
  readonly supportsVoid = false;
  readonly supportsCapture = false;

  createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment — الكاش بيتسجّل مباشرة في PaymentsService.collectCash()');
  }

  verifyWebhook(): WebhookVerificationResult {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'verifyWebhook — مفيش webhook للكاش');
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
