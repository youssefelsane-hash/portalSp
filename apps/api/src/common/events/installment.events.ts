// أحداث محرك التقسيط — نفس نمط أحداث المنصة (fire-and-forget، الـlisteners بتمتلك معالجة
// الأخطاء). أسماء الأحداث اللي ليها routing rules في migration 0177 لازم تفضل متطابقة.

export const INSTALLMENT_APPLICATION_SUBMITTED_EVENT = 'installment.application_submitted';
export const INSTALLMENTS_APPLICATION_REVIEWED_EVENT = 'installments.application_reviewed';
export const INSTALLMENT_PAYMENT_SUCCEEDED_EVENT = 'installments.payment_succeeded';
export const INSTALLMENT_PAYMENT_FAILED_EVENT = 'installment.payment_failed';
export const INSTALLMENT_OVERDUE_ESCALATION_EVENT = 'installment.overdue_escalation';
export const INSTALLMENTS_PLAN_COMPLETED_EVENT = 'installments.plan_completed';

export class InstallmentApplicationSubmittedEvent {
  constructor(
    public readonly applicationId: string,
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly orderNumber: string,
    public readonly totalFinancedCents: number,
  ) {}
}

export class InstallmentApplicationReviewedEvent {
  constructor(
    public readonly applicationId: string,
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly approved: boolean,
    public readonly reasonAr: string | null,
  ) {}
}

export interface InstallmentPaymentResolvedPayload {
  installmentId: string;
  applicationId: string;
  orderId: string;
  customerId: string;
  sequenceNumber: number;
  amountCents: number;
  failureReason: string | null;
}
