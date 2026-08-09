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
