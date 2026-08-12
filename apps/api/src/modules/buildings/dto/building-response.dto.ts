import { Building } from '../entities/building.entity';

export interface BuildingResponseDto {
  id: string;
  code: string;
  name_ar: string;
  address_text: string | null;
  city_id: string | null;
  discount_percentage: number;
  minimum_monthly_orders: number;
  is_active: boolean;
  created_at: string;
}

export function toBuildingResponseDto(building: Building): BuildingResponseDto {
  return {
    id: building.id,
    code: building.code,
    name_ar: building.nameAr,
    address_text: building.addressText,
    city_id: building.cityId,
    discount_percentage: Number(building.discountPercentage),
    minimum_monthly_orders: building.minimumMonthlyOrders,
    is_active: building.isActive,
    created_at: building.createdAt.toISOString(),
  };
}

export interface BuildingWithSubscriptionStatusDto extends BuildingResponseDto {
  /** عدد الطلبات الفعلي المرتبط بالعمارة دي في الشهر التقويمي الحالي (UTC). */
  current_month_orders_count: number;
  /** تتبّع بس — مفيش إنفاذ تلقائي (القرار موثّق في docs/adr/0003-buildings-qr-discount.md). */
  meets_minimum_monthly_orders: boolean;
}

export function toBuildingWithSubscriptionStatusDto(
  building: Building,
  currentMonthOrdersCount: number,
): BuildingWithSubscriptionStatusDto {
  return {
    ...toBuildingResponseDto(building),
    current_month_orders_count: currentMonthOrdersCount,
    meets_minimum_monthly_orders: currentMonthOrdersCount >= building.minimumMonthlyOrders,
  };
}
