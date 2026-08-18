import { apiFetchList } from './api-client';

export interface CityDto {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  timezone: string;
}

export interface AreaDto {
  id: string;
  city_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
}

export interface AddressDto {
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
  is_default: boolean;
  has_active_order: boolean;
}

export const fetchCities = () => apiFetchList<CityDto>('/cities');
export const fetchAreas = (cityId: string) => apiFetchList<AreaDto>(`/cities/${cityId}/areas`);
