// مطابق لـ apps/api/src/modules/admin/dto/customer-response.dto.ts وcustomer-profile.entity.ts
export type CustomerTier = 'standard' | 'silver' | 'gold' | 'vip';

export interface AdminCustomerResponseDto {
  user_id: string;
  full_name: string;
  phone_number: string;
  customer_tier: CustomerTier;
  total_orders_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  total_spent_cents: number;
  loyalty_points_balance: number;
  average_rating_given: string | null;
  is_high_risk: boolean;
  is_blocked: boolean;
  blocked_reason: string | null;
  first_order_at: string | null;
  last_order_at: string | null;
  created_at: string;
  referral_code: string | null;
  referred_by_user_id: string | null;
}

export interface BlockCustomerBody {
  reason: string;
}
