import { City } from '../entities/city.entity';
import { Area } from '../entities/area.entity';

export interface CityResponseDto {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  timezone: string;
}

export function toCityResponseDto(city: City): CityResponseDto {
  return {
    id: city.id,
    name_ar: city.nameAr,
    name_en: city.nameEn,
    slug: city.slug,
    timezone: city.timezone,
  };
}

export interface AreaResponseDto {
  id: string;
  city_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
}

export function toAreaResponseDto(area: Area): AreaResponseDto {
  return {
    id: area.id,
    city_id: area.cityId,
    name_ar: area.nameAr,
    name_en: area.nameEn,
    slug: area.slug,
  };
}
