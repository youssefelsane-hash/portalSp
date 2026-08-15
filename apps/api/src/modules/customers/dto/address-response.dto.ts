import { Address } from '../entities/address.entity';

export interface AddressResponseDto {
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
  contact_name: string | null;
  contact_phone: string | null;
  delivery_notes: string | null;
  is_default: boolean;
  is_verified: boolean;
  // العنوان ده مرتبط بطلب نشط دلوقتي (docs/08 §22 بند 12) — التطبيق بيعرض تحذير بسيط قبل ما
  // العميل يعدّل، عشان مايغيّرش مكان وصول الفني لطلب شغال من غير ما ياخد باله.
  has_active_order: boolean;
}

export function toAddressResponseDto(address: Address, hasActiveOrder = false): AddressResponseDto {
  const [lng, lat] = address.location.coordinates;
  return {
    id: address.id,
    label: address.label,
    city_id: address.cityId,
    area_id: address.areaId,
    street_name: address.streetName,
    building_number: address.buildingNumber,
    floor_number: address.floorNumber,
    apartment_number: address.apartmentNumber,
    landmark: address.landmark,
    latitude: lat,
    longitude: lng,
    contact_name: address.contactName,
    contact_phone: address.contactPhone,
    delivery_notes: address.deliveryNotes,
    is_default: address.isDefault,
    is_verified: address.isVerified,
    has_active_order: hasActiveOrder,
  };
}
