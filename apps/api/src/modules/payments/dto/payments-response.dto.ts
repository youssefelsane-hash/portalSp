import { Wallet } from '../entities/wallet.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { Payment } from '../entities/payment.entity';
import { Payout } from '../entities/payout.entity';
import { PayoutOrderItem } from '../entities/payout-order-item.entity';
import { Refund } from '../entities/refund.entity';
import { SavedPaymentMethod } from '../entities/saved-payment-method.entity';

export interface WalletResponseDto {
  balance_cents: number;
  pending_balance_cents: number;
  reserved_balance_cents: number;
  total_earned_cents: number;
  total_withdrawn_cents: number;
  currency_code: string;
  is_frozen: boolean;
}

export function toWalletResponseDto(wallet: Wallet): WalletResponseDto {
  return {
    balance_cents: wallet.balanceCents,
    pending_balance_cents: wallet.pendingBalanceCents,
    reserved_balance_cents: wallet.reservedBalanceCents,
    total_earned_cents: wallet.totalEarnedCents,
    total_withdrawn_cents: wallet.totalWithdrawnCents,
    currency_code: wallet.currencyCode,
    is_frozen: wallet.isFrozen,
  };
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

export function toWalletTransactionResponseDto(tx: WalletTransaction): WalletTransactionResponseDto {
  return {
    id: tx.id,
    transaction_number: tx.transactionNumber,
    direction: tx.direction,
    transaction_type: tx.transactionType,
    amount_cents: tx.amountCents,
    balance_after_cents: tx.balanceAfterCents,
    description_ar: tx.descriptionAr,
    is_reversed: tx.isReversed,
    created_at: tx.createdAt.toISOString(),
  };
}

export interface PaymentResponseDto {
  id: string;
  payment_number: string;
  order_id: string;
  amount_cents: number;
  payment_method: string;
  payment_status: string;
  completed_at: string | null;
  /** null = دفعة الطلب الأصلية، غير null = محاولة تحصيل شغل إضافي (docs/08 §21). */
  order_item_batch_id: string | null;
  /** InstaPay بس — العميل قال إنه حوّل فعليًا (مش تأكيد نهائي، ده لسه بيتم من الأدمن). */
  customer_confirmed_transfer_at: string | null;
  failure_message: string | null;
}

export function toPaymentResponseDto(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    payment_number: payment.paymentNumber,
    order_id: payment.orderId,
    amount_cents: payment.amountCents,
    payment_method: payment.paymentMethod,
    payment_status: payment.paymentStatus,
    completed_at: payment.completedAt ? payment.completedAt.toISOString() : null,
    order_item_batch_id: payment.orderItemBatchId,
    customer_confirmed_transfer_at: payment.customerConfirmedTransferAt
      ? payment.customerConfirmedTransferAt.toISOString()
      : null,
    failure_message: payment.failureMessage,
  };
}

// §28 — طابور تأكيد InstaPay الإداري (كانت فجوة حقيقية: مفيش أي شاشة/endpoint بيجمّع الدفعات
// المعلّقة، الأدمن كان مضطر يدور عليها طلب-طلب من جوّه تفاصيل كل طلب لوحده). فيه اسم/رقم العميل
// (مش UUID خام — نفس درس §28.1) عشان الطابور يبقى قابل للاستخدام فعليًا من غير نداء تاني.
export interface InstaPayPendingPaymentResponseDto {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  amount_cents: number;
  gateway_reference: string | null;
  initiated_at: string;
  customer_confirmed_transfer_at: string | null;
}

export interface SavedPaymentMethodResponseDto {
  id: string;
  provider: string;
  card_brand: string | null;
  masked_pan: string | null;
  is_default: boolean;
  created_at: string;
}

export function toSavedPaymentMethodResponseDto(method: SavedPaymentMethod): SavedPaymentMethodResponseDto {
  return {
    id: method.id,
    provider: method.provider,
    card_brand: method.cardBrand,
    masked_pan: method.maskedPan,
    is_default: method.isDefault,
    created_at: method.createdAt.toISOString(),
  };
}

export interface CardPaymentResponseDto {
  payment: PaymentResponseDto;
  redirect_url: string;
}

export interface FawryReferenceResponseDto {
  payment: PaymentResponseDto;
  reference_number: string;
  expires_at: string | null;
}

export interface InstaPayReferenceResponseDto {
  payment: PaymentResponseDto;
  reference_code: string;
  instructions_ar: string;
}

export interface PayoutResponseDto {
  id: string;
  payout_number: string;
  amount_cents: number;
  net_amount_cents: number;
  payout_method: string;
  payout_status: string;
  requested_at: string;
  completed_at: string | null;
}

export function toPayoutResponseDto(payout: Payout): PayoutResponseDto {
  return {
    id: payout.id,
    payout_number: payout.payoutNumber,
    amount_cents: payout.amountCents,
    net_amount_cents: payout.netAmountCents,
    payout_method: payout.payoutMethod,
    payout_status: payout.payoutStatus,
    requested_at: payout.requestedAt.toISOString(),
    completed_at: payout.completedAt ? payout.completedAt.toISOString() : null,
  };
}

// مطابق لـ PayoutWithTechnician في payouts.service.ts — لقايمة الأدمن بس (GET /admin/payouts)،
// محتاجة تعرف مين الفني طالب الصرف عشان تكون قابلة للتصرف عليها فعلياً.
export interface AdminPayoutResponseDto extends PayoutResponseDto {
  technician_code: string;
  technician_name: string;
  technician_user_id: string;
  rejection_reason: string | null;
}

export function toAdminPayoutResponseDto(row: { payout: Payout; technicianCode: string; technicianName: string; technicianUserId: string }): AdminPayoutResponseDto {
  return {
    ...toPayoutResponseDto(row.payout),
    technician_code: row.technicianCode,
    technician_name: row.technicianName,
    technician_user_id: row.technicianUserId,
    rejection_reason: row.payout.rejectionReason,
  };
}

export interface PayoutOrderItemResponseDto {
  order_id: string;
  earning_cents: number;
  commission_cents: number;
}

export function toPayoutOrderItemResponseDto(item: PayoutOrderItem): PayoutOrderItemResponseDto {
  return {
    order_id: item.orderId,
    earning_cents: item.earningCents,
    commission_cents: item.commissionCents,
  };
}

export interface RefundResponseDto {
  id: string;
  refund_number: string;
  payment_id: string;
  order_id: string;
  amount_cents: number;
  refund_type: string;
  refund_method: string;
  refund_status: string;
  reason_notes: string | null;
  requested_at: string;
  completed_at: string | null;
  provider_refund_id: string | null;
}

export function toRefundResponseDto(refund: Refund): RefundResponseDto {
  return {
    id: refund.id,
    refund_number: refund.refundNumber,
    payment_id: refund.paymentId,
    order_id: refund.orderId,
    amount_cents: refund.amountCents,
    refund_type: refund.refundType,
    refund_method: refund.refundMethod,
    refund_status: refund.refundStatus,
    reason_notes: refund.reasonNotes,
    requested_at: refund.requestedAt.toISOString(),
    completed_at: refund.completedAt ? refund.completedAt.toISOString() : null,
    provider_refund_id: refund.providerRefundId,
  };
}

// Script 2 Part I (findings #46/#47) — راجع payment-provider.registry.ts's listAll() للسياق الكامل.
export interface PaymentChannelResponseDto {
  method: string;
  is_available: boolean;
}
