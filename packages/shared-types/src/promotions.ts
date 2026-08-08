// مطابق لـ apps/api/src/modules/promotions/dto/*.ts وentities/promo-code.entity.ts
export type DiscountType = 'percentage' | 'fixed_amount' | 'free_inspection';

export interface PromoCodeResponseDto {
  id: string;
  code: string;
  name_ar: string;
  discount_type: DiscountType;
  discount_value: number;
  max_discount_cents: number | null;
  min_order_amount_cents: number;
  usage_limit_total: number | null;
  usage_limit_per_user: number;
  used_count: number;
  applies_to_service_ids: string[] | null;
  applies_to_zone_ids: string[] | null;
  new_customers_only: boolean;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  budget_cents: number | null;
  spent_cents: number;
  created_at: string;
}

export interface CreatePromoCodeBody {
  code: string;
  name_ar: string;
  discount_type: DiscountType;
  discount_value: number;
  max_discount_cents?: number;
  min_order_amount_cents?: number;
  usage_limit_total?: number;
  usage_limit_per_user?: number;
  new_customers_only?: boolean;
  valid_from: string;
  valid_until: string;
  budget_cents?: number;
}
