// مطابق لـ apps/api/src/modules/geo/dto/admin-geo-response.dto.ts + create/update DTOs
export interface AdminCountryResponseDto {
  id: string;
  name_ar: string;
  name_en: string;
  iso_code: string;
  is_active: boolean;
}

export interface AdminCityResponseDto {
  id: string;
  country_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  launched_at: string | null;
  created_at: string;
}

export interface CreateCityBody {
  country_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

export interface AdminAreaResponseDto {
  id: string;
  city_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  is_launched: boolean;
  created_at: string;
}

export interface CreateAreaBody {
  city_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  latitude?: number;
  longitude?: number;
}

export interface AdminServiceZoneResponseDto {
  id: string;
  city_id: string;
  name_ar: string;
  name_en: string;
  surge_multiplier: number;
  min_order_amount_cents: number | null;
  is_active: boolean;
  has_boundary: boolean;
  created_at: string;
}

export interface CreateServiceZoneBody {
  city_id: string;
  name_ar: string;
  name_en: string;
  surge_multiplier?: number;
  min_order_amount_cents?: number;
}
