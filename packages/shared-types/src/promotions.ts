import type { MarketingChannel } from './marketing';

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
  discount_enabled: boolean;
  marketing_channel: MarketingChannel | null;
  marketing_region_label: string | null;
  marketing_notes: string | null;
  payout_per_completed_order_cents: number;
  payout_contact_name: string | null;
  payout_contact_phone: string | null;
  /** رابط عام قابل للمشاركة وQR؛ يفتح رحلة العميل مع الكود بعد تسجيل زيارة. */
  share_url: string;
  /** زيارات الرابط، وليست عدد مستخدمين فريدين. */
  link_hit_count: number;
  /** حسابات جديدة أُنشئت بعد فتح الرابط؛ لا تعني مرات استخدام الخصم. */
  link_signup_count: number;
  attributed_order_count: number;
  attributed_completed_order_count: number;
  attributed_gross_revenue_cents: number;
  attributed_platform_revenue_cents: number;
  accrued_partner_commission_cents: number;
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
  applies_to_service_ids?: string[];
  applies_to_zone_ids?: string[];
  discount_enabled?: boolean;
  marketing_channel?: MarketingChannel;
  marketing_region_label?: string;
  marketing_notes?: string;
  payout_per_completed_order_cents?: number;
  payout_contact_name?: string;
  payout_contact_phone?: string;
}

export interface PromoMarketingCommissionDto {
  id: string;
  promoCodeId: string;
  orderId: string;
  customerUserId: string;
  amountCents: number;
  status: 'accrued' | 'paid' | 'cancelled';
  accruedAt: string;
  paidAt: string | null;
  paidByUserId: string | null;
  paymentNote: string | null;
}
