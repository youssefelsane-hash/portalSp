import { User } from '../../auth/entities/user.entity';
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';

export interface AdminCustomerResponseDto {
  user_id: string;
  full_name: string;
  phone_number: string;
  customer_tier: string;
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

export function toAdminCustomerResponseDto(profile: CustomerProfile, user: User): AdminCustomerResponseDto {
  return {
    user_id: user.id,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    customer_tier: profile.customerTier,
    total_orders_count: profile.totalOrdersCount,
    completed_orders_count: profile.completedOrdersCount,
    cancelled_orders_count: profile.cancelledOrdersCount,
    total_spent_cents: profile.totalSpentCents,
    loyalty_points_balance: profile.loyaltyPointsBalance,
    average_rating_given: profile.averageRatingGiven,
    is_high_risk: profile.isHighRisk,
    is_blocked: user.isBlocked,
    blocked_reason: user.blockedReason,
    first_order_at: profile.firstOrderAt ? profile.firstOrderAt.toISOString() : null,
    last_order_at: profile.lastOrderAt ? profile.lastOrderAt.toISOString() : null,
    created_at: profile.createdAt.toISOString(),
    referral_code: user.referralCode,
    referred_by_user_id: user.referredByUserId,
  };
}
