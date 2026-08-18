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

export interface CreditLoyaltyBody {
  points: number;
}

export interface BlockCustomerBody {
  reason: string;
}

// مطابق لـ apps/api/src/modules/customers/dto/address-response.dto.ts — Call Center (Script 4
// §33-37) بيستخدمها لعرض عناوين العميل قبل إنشاء طلب نيابة عنه (GET /admin/customers/:userId/addresses).
export interface AddressResponseDto {
  id: string;
  label: string | null;
  city_id: string | null;
  area_id: string | null;
  street_name: string;
  building_number: string | null;
  floor_number: string | null;
  apartment_number: string | null;
  landmark: string | null;
  latitude: number;
  longitude: number;
  contact_name: string | null;
  contact_phone: string | null;
  delivery_notes: string | null;
  is_default: boolean;
  is_verified: boolean;
  has_active_order: boolean;
}
