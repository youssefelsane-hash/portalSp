import { AddressDto } from './geo-addresses';

// مطابق لـ apps/api/src/modules/customers/dto/create-address.dto.ts بالحرف.
export interface CreateAddressBody {
  label?: string;
  city_id: string;
  area_id: string;
  street_name: string;
  building_number?: string;
  floor_number?: string;
  apartment_number?: string;
  landmark?: string;
  latitude: number;
  longitude: number;
  contact_name?: string;
  contact_phone?: string;
  delivery_notes?: string;
  is_default?: boolean;
}

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export const listAddresses = (authedFetch: AuthedFetch) => authedFetch<AddressDto[]>('/addresses');

export const createAddress = (authedFetch: AuthedFetch, body: CreateAddressBody) =>
  authedFetch<AddressDto>('/addresses', { method: 'POST', body: JSON.stringify(body) });

export type { AddressDto };
