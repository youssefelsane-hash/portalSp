// مطابق لـ apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts وentities
export type PricingModel = 'fixed' | 'hourly' | 'per_unit' | 'inspection_then_quote';

export interface AdminServiceCategoryResponseDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar: string | null;
  icon_url: string | null;
  display_order: number;
  is_active: boolean;
  is_featured: boolean;
  launch_phase: number;
  created_at: string;
}

export interface CreateServiceCategoryBody {
  parent_category_id?: string;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar?: string;
  icon_url?: string;
  display_order?: number;
  is_featured?: boolean;
  launch_phase?: number;
}

export interface UpdateServiceCategoryBody extends Partial<CreateServiceCategoryBody> {
  is_active?: boolean;
}

export interface AdminServiceResponseDto {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  short_description_ar: string | null;
  full_description_ar: string | null;
  icon_url: string | null;
  pricing_model: PricingModel;
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
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  launch_phase: number;
  created_at: string;
}

export interface CreateServiceBody {
  category_id: string;
  name_ar: string;
  name_en?: string;
  slug: string;
  short_description_ar?: string;
  full_description_ar?: string;
  icon_url?: string;
  pricing_model: PricingModel;
  base_price_cents: number;
  inspection_fee_cents?: number;
  min_price_cents?: number;
  max_price_cents?: number;
  unit_name_ar?: string;
  estimated_duration_minutes?: number;
  warranty_days?: number;
  requires_photos?: boolean;
  allows_scheduling?: boolean;
  allows_emergency?: boolean;
  min_technician_level?: string;
  commission_percentage?: number;
  display_order?: number;
  launch_phase?: number;
}

export interface UpdateServiceBody extends Partial<CreateServiceBody> {
  is_active?: boolean;
}
