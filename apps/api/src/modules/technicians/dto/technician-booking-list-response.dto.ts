import { PriceEstimate } from '../../catalog/catalog.service';
import { TechnicianBookingListItem } from '../technicians.service';

export interface TechnicianBookingListItemResponseDto {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  distance_km: number | null;
  // مضاعف سعر مستوى الفني (docs/08) — العميل لازم يشوف رتبة الفني والسعر النهائي المحسوب فعليًا
  // بيها قبل ما يختاره، مش بعد التأكيد. final_price_cents = null لخدمات pricing_model=formula
  // (المضاعف مش بيتطبّق عليها أصلاً، وتفصيل السعر محتاج field_values مش متاحة في القايمة دي).
  technician_level: string;
  final_price_cents: number | null;
  level_price_multiplier: number | null;
  is_verified: boolean;
  on_time_rate: number | null;
  avg_arrival_minutes: number | null;
}

export function toTechnicianBookingListItemResponseDto(
  item: TechnicianBookingListItem,
  estimate: PriceEstimate | null,
): TechnicianBookingListItemResponseDto {
  return {
    id: item.technicianId,
    full_name: item.fullName,
    avatar_url: item.avatarUrl,
    bio: item.bio,
    average_rating: item.averageRating,
    total_ratings_count: item.totalRatingsCount,
    completed_orders_count: item.serviceCompletedCount,
    distance_km: item.distanceKm !== null ? Math.round(item.distanceKm * 100) / 100 : null,
    technician_level: item.currentLevel,
    final_price_cents: estimate ? estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents : null,
    level_price_multiplier: estimate ? estimate.level_price_multiplier : null,
    is_verified: item.isVerified,
    on_time_rate: item.onTimeRatePercent,
    avg_arrival_minutes: item.avgArrivalMinutes,
  };
}
