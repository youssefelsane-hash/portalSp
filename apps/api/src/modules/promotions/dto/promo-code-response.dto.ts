import { PromoCode } from '../entities/promo-code.entity';

export interface PromoCodeResponseDto {
  id: string;
  code: string;
  name_ar: string;
  discount_type: string;
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

export function toPromoCodeResponseDto(promoCode: PromoCode): PromoCodeResponseDto {
  return {
    id: promoCode.id,
    code: promoCode.code,
    name_ar: promoCode.nameAr,
    discount_type: promoCode.discountType,
    discount_value: Number(promoCode.discountValue),
    max_discount_cents: promoCode.maxDiscountCents,
    min_order_amount_cents: promoCode.minOrderAmountCents,
    usage_limit_total: promoCode.usageLimitTotal,
    usage_limit_per_user: promoCode.usageLimitPerUser,
    used_count: promoCode.usedCount,
    applies_to_service_ids: promoCode.appliesToServiceIds,
    applies_to_zone_ids: promoCode.appliesToZoneIds,
    new_customers_only: promoCode.newCustomersOnly,
    valid_from: promoCode.validFrom.toISOString(),
    valid_until: promoCode.validUntil.toISOString(),
    is_active: promoCode.isActive,
    budget_cents: promoCode.budgetCents,
    spent_cents: promoCode.spentCents,
    created_at: promoCode.createdAt.toISOString(),
  };
}

export interface PromoValidationResponseDto {
  promo_code: PromoCodeResponseDto;
  discount_cents: number;
}
