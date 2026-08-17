// ترشيح QR للفني (docs/11 §1) — مطابق لـ
// apps/api/src/modules/technician-referrals/dto/technician-referral-response.dto.ts.
export type TechnicianReferralBonusStatus = 'credited' | 'revoked' | 'rejected_suspicious' | 'manual_review';

export interface TechnicianReferralBonusResponseDto {
  id: string;
  technician_id: string;
  customer_user_id: string;
  order_id: string;
  bonus_amount_cents: number;
  status: TechnicianReferralBonusStatus;
  rejection_reason: string | null;
  credited_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
}

export interface TechnicianReferralSummaryResponseDto {
  referral_token: string;
  attributed_customers_count: number;
  qualifying_orders_count: number;
  total_credited_cents: number;
  total_revoked_cents: number;
  total_rejected_cents: number;
  recent_bonuses: TechnicianReferralBonusResponseDto[];
}
