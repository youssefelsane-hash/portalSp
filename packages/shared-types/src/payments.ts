// مطابق لـ apps/api/src/modules/payments/dto/payments-response.dto.ts وentities/payout.entity.ts
export type PayoutMethod = 'bank_transfer' | 'vodafone_cash' | 'instapay' | 'cash';

export type PayoutStatus = 'requested' | 'under_review' | 'approved' | 'processing' | 'completed' | 'rejected' | 'failed';

export interface AdminPayoutResponseDto {
  id: string;
  payout_number: string;
  amount_cents: number;
  net_amount_cents: number;
  payout_method: PayoutMethod;
  payout_status: PayoutStatus;
  requested_at: string;
  completed_at: string | null;
  technician_code: string;
  technician_name: string;
  technician_user_id: string;
  rejection_reason: string | null;
}

export interface RejectPayoutBody {
  reason: string;
}

export interface PayoutOrderItemResponseDto {
  order_id: string;
  earning_cents: number;
  commission_cents: number;
}

export interface RefundOrderBody {
  reason_notes: string;
}

// مطابق لـ apps/api/src/modules/payments/entities/payment.entity.ts — الملخص المالي لكل طلب
// (docs/08 §20 بند 11).
export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'bank_transfer' | 'corporate_credit' | 'fawry_reference' | 'instapay';

export type PaymentGatewayStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded';

// مطابق لـ apps/api/src/modules/payments/entities/refund.entity.ts
export type RefundType = 'full' | 'partial';
export type RefundMethod = 'original_method' | 'wallet_credit' | 'cash';
export type RefundStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';

// مطابق لـ apps/api/src/modules/orders/dto/order-financial-summary-response.dto.ts —
// GET /admin/orders/:id/financial-summary (docs/08 §20 بند 11): كانت فجوة عرض حقيقية —
// عمولة المنصة/أرباح الفني محسوبة ومخزّنة على الطلب من زمان بس صفر endpoint كان بيرجّعها.
export interface OrderPaymentSummaryDto {
  id: string;
  payment_method: PaymentMethod;
  payment_status: PaymentGatewayStatus;
  amount_cents: number;
  completed_at: string | null;
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

export interface WalletResponseDto {
  balance_cents: number;
  pending_balance_cents: number;
  reserved_balance_cents: number;
  total_earned_cents: number;
  total_withdrawn_cents: number;
  currency_code: string;
  is_frozen: boolean;
}

export interface WalletTransactionResponseDto {
  id: string;
  transaction_number: string;
  direction: string;
  transaction_type: string;
  amount_cents: number;
  balance_after_cents: number;
  description_ar: string | null;
  is_reversed: boolean;
  created_at: string;
}

export interface AdminWalletDetailResponseDto {
  wallet: WalletResponseDto;
  transactions: WalletTransactionResponseDto[];
}
