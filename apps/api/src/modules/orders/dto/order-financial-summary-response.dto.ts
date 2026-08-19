import { Payment, PaymentGatewayStatus, PaymentMethod } from '../../payments/entities/payment.entity';
import { Refund, RefundMethod, RefundStatus, RefundType } from '../../payments/entities/refund.entity';

// الملخص المالي لطلب واحد (docs/08 §20 بند 11) — راجع PaymentsService.getFinancialSummaryForOrder()
// للسبب: الحقول دي (عمولة/أرباح) كانت محسوبة ومخزّنة على الطلب من زمان بس مش معروضة لأي أدمن.
export interface OrderPaymentSummaryDto {
  id: string;
  payment_method: PaymentMethod;
  payment_status: PaymentGatewayStatus;
  amount_cents: number;
  completed_at: string | null;
  /** غير null = محاولة تحصيل شغل إضافي معتمد (docs/08 §21)، مش دفعة الطلب الأصلية. */
  order_item_batch_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  /** InstaPay بس — العميل قال إنه حوّل فعليًا (مش تأكيد نهائي). */
  customer_confirmed_transfer_at: string | null;
}

export interface OrderRefundSummaryDto {
  id: string;
  amount_cents: number;
  refund_type: RefundType;
  refund_method: RefundMethod;
  refund_status: RefundStatus;
  completed_at: string | null;
}

export interface OrderFinancialSummaryResponseDto {
  platform_commission_cents: number;
  technician_earning_cents: number;
  cancellation_fee_cents: number;
  payments: OrderPaymentSummaryDto[];
  refunds: OrderRefundSummaryDto[];
}

export function toOrderFinancialSummaryResponseDto(summary: {
  platformCommissionCents: number;
  technicianEarningCents: number;
  cancellationFeeCents: number;
  payments: Pick<
    Payment,
    | 'id'
    | 'paymentMethod'
    | 'paymentStatus'
    | 'amountCents'
    | 'completedAt'
    | 'orderItemBatchId'
    | 'failureCode'
    | 'failureMessage'
    | 'customerConfirmedTransferAt'
  >[];
  refunds: Pick<Refund, 'id' | 'amountCents' | 'refundType' | 'refundMethod' | 'refundStatus' | 'completedAt'>[];
}): OrderFinancialSummaryResponseDto {
  return {
    platform_commission_cents: summary.platformCommissionCents,
    technician_earning_cents: summary.technicianEarningCents,
    cancellation_fee_cents: summary.cancellationFeeCents,
    payments: summary.payments.map((p) => ({
      id: p.id,
      payment_method: p.paymentMethod,
      payment_status: p.paymentStatus,
      amount_cents: p.amountCents,
      completed_at: p.completedAt ? p.completedAt.toISOString() : null,
      order_item_batch_id: p.orderItemBatchId,
      failure_code: p.failureCode,
      failure_message: p.failureMessage,
      customer_confirmed_transfer_at: p.customerConfirmedTransferAt ? p.customerConfirmedTransferAt.toISOString() : null,
    })),
    refunds: summary.refunds.map((r) => ({
      id: r.id,
      amount_cents: r.amountCents,
      refund_type: r.refundType,
      refund_method: r.refundMethod,
      refund_status: r.refundStatus,
      completed_at: r.completedAt ? r.completedAt.toISOString() : null,
    })),
  };
}
