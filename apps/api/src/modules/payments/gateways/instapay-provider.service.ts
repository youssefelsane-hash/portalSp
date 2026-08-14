import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../../settings/settings.service';
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
 * InstaPay — مسبق الدفع، **تأكيد يدوي بس** (ADR-0013 §7 من توجيه المالك 2026-08-14). مفيش
 * تكامل webhook تلقائي موثوق متاح لـInstaPay في مصر لأي منصة تجارية عادية دلوقتي — العميل بيحوّل
 * يدويًا لرقم/IPA معلن، وموظف Finance مُصرَّح له بس هو اللي بيأكّد الاستلام
 * (`POST /admin/payments/:id/confirm-instapay`، صلاحية `payments.confirm_manual` مخصوصة).
 * `createPayment()` هنا بترجّع تعليمات التحويل بس، مش رابط دفع فعلي — `payment_status` يفضل
 * `pending` لحد التأكيد الإداري.
 */
@Injectable()
export class InstaPayProvider implements PaymentProvider {
  readonly providerKey = 'instapay';
  readonly isConfigured: boolean;
  readonly supportsRefund = false; // استرداد InstaPay = wallet credit fallback، نفس الكاش
  readonly supportsVoid = false;
  readonly supportsCapture = false;

  private readonly ipaAddress: string | undefined;
  private readonly recipientName: string | undefined;

  constructor(
    config: ConfigService,
    private readonly settingsService: SettingsService,
  ) {
    this.ipaAddress = config.get<string>('payments.instapay.ipaAddress') || undefined;
    this.recipientName = config.get<string>('payments.instapay.recipientName') || undefined;
    this.isConfigured = Boolean(this.ipaAddress && this.recipientName);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured) {
      throw new PaymentOperationNotSupportedError(this.providerKey, 'createPayment — عنوان IPA مش مُعدّ');
    }
    // نافذة التأكيد اليدوي قابلة للتحكم من الأدمن (ADR-0013 §7 + §13) — مش رقم دائم مُخترع، ده
    // نفس الرقم اللي notifications.action_required (§13) هيستخدمه لإيقاف التذكيرات بعد انتهاء الصلاحية.
    const windowHours = await this.settingsService.getNumber('payments.instapay_confirmation_window_hours', 24);
    const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000);
    return {
      kind: 'reference',
      referenceCode: input.paymentId,
      instructionsAr:
        `حوّل ${(input.amountCents / 100).toFixed(2)} ج.م عبر InstaPay لـ ${this.ipaAddress} ` +
        `(${this.recipientName}) — واكتب رقم طلبك ${input.orderNumber} في ملاحظة التحويل. ` +
        `هيتم تأكيد الدفع خلال وقت قصير من فريق الدعم.`,
      providerReference: input.paymentId,
      expiresAt,
    };
  }

  verifyWebhook(): WebhookVerificationResult {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'verifyWebhook — تأكيد InstaPay يدوي بس، مفيش webhook');
  }

  getPaymentStatus(_providerReference: string): Promise<PaymentStatusResult> {
    throw new PaymentOperationNotSupportedError(this.providerKey, 'getPaymentStatus — تأكيد يدوي بس');
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
    throw new PaymentOperationNotSupportedError(this.providerKey, 'reconcile — تأكيد يدوي بس');
  }
}
