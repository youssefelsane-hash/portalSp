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
 * محفظة داخلية — بلا بوابة خارجية خالص (ADR-0013)، نفس فلسفة CashProvider بالحرف. التسجيل الفعلي
 * بيحصل في PaymentsService.payWithWallet() عبر WalletsService.doubleEntry() الموجودة، مش هنا.
 */
@Injectable()
export class WalletProvider implements PaymentProvider {
  readonly providerKey = 'wallet';
  readonly isConfigured = true;
  readonly supportsRefund = false;
  readonly supportsVoid = false;
  readonly supportsCapture = false;

  createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment — المحفظة بتتسجّل مباشرة في PaymentsService.payWithWallet()');
  }

  verifyWebhook(): WebhookVerificationResult {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'verifyWebhook — مفيش webhook للمحفظة');
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
