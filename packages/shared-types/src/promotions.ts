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

/**
 * مستحق شريك كود خصم — **بهوية الشريك ورقم الطلب** (docs/08 §164).
 *
 * الشكل القديم كان بيرجّع الكيان الخام بـ`camelCase` ومعرّفات بس، فالأدمن كان بيشوف UUID
 * الطلب واسم الشريك مش ظاهر خالص. الأسماء دلوقتي `snake_case` لأن الرد بقى استعلام مباشر
 * زي باقي ردود الأدمن الخام.
 */
export interface PromoMarketingCommissionDto {
  id: string;
  promo_code_id: string;
  order_id: string;
  customer_user_id: string;
  amount_cents: number;
  status: 'accrued' | 'paid' | 'cancelled';
  accrued_at: string;
  paid_at: string | null;
  paid_by_user_id: string | null;
  payment_note: string | null;
  /** الكود نفسه — بديل عن البحث في قايمة الأكواد المقسّمة لصفحات في المتصفح. */
  promo_code: string;
  promo_name_ar: string;
  /** بيانات الشريك/المؤثّر اللي هياخد الفلوس — كانت مخزّنة ومرجّعة لكن غير معروضة. */
  payout_contact_name: string | null;
  payout_contact_phone: string | null;
  marketing_channel: MarketingChannel | null;
  order_number: string | null;
  order_total_cents: number | null;
  order_closed_at: string | null;
  customer_name: string | null;
}
