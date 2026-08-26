// أنواع مطابقة لعقد الـAPI الحقيقي (docs/02-data-dictionary.md) — نسخة محلية بدل الاعتماد على
// @baytak/shared-types (تفادي تعقيد workspace linking لأول نسخة من customer-web، نفس فلسفة
// customer-app الـFlutter اللي عندها نماذجها الخاصة بدل codegen مشترك). أي تعديل في عقد الباك-إند
// لازم ينعكس هنا يدويًا.

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  meta: unknown;
  error: { code: string; message: string } | null;
  request_id: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in_seconds: number;
}

export interface UserResponseDto {
  id: string;
  phone_number: string;
  phone_verified: boolean;
  email: string | null;
  full_name: string;
  avatar_url: string | null;
  user_type: string;
  preferred_language: string;
  created_at: string;
}

export interface ServiceCategoryDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  icon_url: string | null;
  is_featured: boolean;
}

// مطابق لـ apps/api/src/modules/settings/homepage-content.controller.ts
export interface HomepageTipDto {
  title: string;
  body: string;
  image_url: string | null;
}

export interface HomepageContentDto {
  trust_message: string;
  hero_images: string[];
  search: {
    eyebrow: string;
    title: string;
    description: string;
    placeholder: string;
  };
  tips: HomepageTipDto[];
}

// مطابق لـ apps/api/src/modules/settings/support-contact.controller.ts — نفس البيانات
// المعروضة في apps/customer-app/apps/technician-app's شاشة الدعم، دلوقتي متاحة لـcustomer-web كمان.
export interface SupportContactDto {
  enabled: boolean;
  phone_number: string | null;
  whatsapp_number: string | null;
  whatsapp_url: string | null;
  email: string | null;
  help_url: string | null;
}

// مطابق لـ apps/api/src/modules/branding/dto/branding-response.dto.ts's BrandingAssetResponseDto —
// بس أصل الـ`splash` (خلفية الشاشة الرئيسية وراء صندوق البحث)، بقية الأصول (logo_mark/...) مش
// مستهلكة في customer-web لسه. `is_default=true` = الأدمن ما رفعش صورة، استخدم تدرّج الـHERO_SLIDES
// المحلي بدلها (راجع page.tsx).
export interface BrandingAssetDto {
  url: string;
  is_default: boolean;
}

export interface ServiceDto {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  short_description_ar: string | null;
  full_description_ar: string | null;
  pricing_model: 'fixed' | 'hourly' | 'per_unit' | 'inspection_then_quote' | 'formula';
  base_price_cents: number;
  inspection_fee_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  unit_name_ar: string | null;
  estimated_duration_minutes: number | null;
  warranty_days: number;
  requires_photos: boolean;
  allows_scheduling: boolean;
  allows_emergency: boolean;
  allows_individual: boolean;
  allows_team: boolean;
  // قدرة "الحجز المتكرر" (migration 0176) — nullable في النوع عشان ردود قديمة محتملة،
  // fallback false في الاستخدام.
  allows_recurring_booking?: boolean;
}

export interface PricingFieldOptionDto {
  value: string;
  label_ar: string;
}

export interface PricingFieldDto {
  id: string;
  field_key: string;
  label_ar: string;
  field_type: string;
  unit_ar: string | null;
  is_required: boolean;
  display_order: number;
  options: PricingFieldOptionDto[] | null;
  min_value: number | null;
  max_value: number | null;
}

export interface PriceEstimateDto {
  base_price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  level_price_multiplier: number;
  estimated_total_cents: number;
  emergency_surcharge_cents: number;
  emergency_sla_minutes: number | null;
  min_price_cents: number | null;
  max_price_cents: number | null;
  pricing_evaluation_id: string | null;
  estimated_duration_days: number | null;
}

// AddressDto الصحيح موجود في geo-addresses.ts (مطابق لـ AddressResponseDto الحقيقي بالباك-إند).
// OrderDto الكامل موجود في orders.ts (مطابق لـ OrderResponseDto بالحرف).

export interface PaymentChannelDto {
  method: 'cash' | 'wallet' | 'card' | 'instapay' | 'fawry_reference';
  is_available: boolean;
}
