import { Area } from '../entities/area.entity';
import { City } from '../entities/city.entity';
import { ServiceZone } from '../entities/service-zone.entity';

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

export function toAdminCityResponseDto(city: City): AdminCityResponseDto {
  return {
    id: city.id,
    country_id: city.countryId,
    name_ar: city.nameAr,
    name_en: city.nameEn,
    slug: city.slug,
    timezone: city.timezone,
    latitude: city.centerLocation ? city.centerLocation.coordinates[1] : null,
    longitude: city.centerLocation ? city.centerLocation.coordinates[0] : null,
    is_active: city.isActive,
    launched_at: city.launchedAt ? city.launchedAt.toISOString() : null,
    created_at: city.createdAt.toISOString(),
  };
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

export function toAdminAreaResponseDto(area: Area): AdminAreaResponseDto {
  return {
    id: area.id,
    city_id: area.cityId,
    name_ar: area.nameAr,
    name_en: area.nameEn,
    slug: area.slug,
    latitude: area.centerLocation ? area.centerLocation.coordinates[1] : null,
    longitude: area.centerLocation ? area.centerLocation.coordinates[0] : null,
    is_active: area.isActive,
    is_launched: area.isLaunched,
    created_at: area.createdAt.toISOString(),
  };
}

export interface AdminServiceZoneResponseDto {
  id: string;
  city_id: string;
  name_ar: string;
  name_en: string;
  surge_multiplier: number;
  min_order_amount_cents: number | null;
  is_active: boolean;
  created_at: string;
}

export function toAdminServiceZoneResponseDto(zone: ServiceZone): AdminServiceZoneResponseDto {
  return {
    id: zone.id,
    city_id: zone.cityId,
    name_ar: zone.nameAr,
    name_en: zone.nameEn,
    surge_multiplier: Number(zone.surgeMultiplier),
    min_order_amount_cents: zone.minOrderAmountCents,
    is_active: zone.isActive,
    created_at: zone.createdAt.toISOString(),
  };
}
