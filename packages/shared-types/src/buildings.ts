// نظام العمائر (docs/08 §13, ADR-0003) — مطابق لـ
// apps/api/src/modules/buildings/dto/building-response.dto.ts وdto إنشاء/تعديل العمارة.
export interface BuildingWithSubscriptionStatusDto {
  id: string;
  code: string;
  name_ar: string;
  address_text: string | null;
  city_id: string | null;
  discount_percentage: number;
  minimum_monthly_orders: number;
  is_active: boolean;
  created_at: string;
  current_month_orders_count: number;
  meets_minimum_monthly_orders: boolean;
}

export interface CreateBuildingBody {
  name_ar: string;
  address_text?: string;
  city_id?: string;
  discount_percentage?: number;
  minimum_monthly_orders?: number;
}

export interface UpdateBuildingBody {
  name_ar?: string;
  address_text?: string;
  city_id?: string;
  discount_percentage?: number;
  minimum_monthly_orders?: number;
  is_active?: boolean;
}

export interface BuildingQrCodeResponseDto {
  building_code: string;
  qr_data_uri: string;
}
