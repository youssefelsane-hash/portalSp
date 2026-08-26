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
  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — مستقلة عن technician_level فوق، بتتبعت
  // نفس نمط الشفافية (final_price_cents/level_price_multiplier) عشان العميل/الدعم يقدروا يفهموا
  // أساس السعر المعروض بالظبط.
  pricing_tier: string;
  final_price_cents: number | null;
  level_price_multiplier: number | null;
  is_verified: boolean;
  on_time_rate: number | null;
  avg_arrival_minutes: number | null;
  // اندماج الشركات في نفس القايمة (docs/08 §38) — id هنا يبقى technician_companies.id للشركات.
  is_company: boolean;
  staff_count: number | null;
  branch_count: number | null;
  company_id: string | null;
  company_name: string | null;
  is_commercial_company: boolean;
  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) — 'available' دايمًا لأي
  // فني كان بيظهر قبل كده (رجريشن صفري). 'schedule_conflicted' بس لصفوف إضافية جديدة، مؤهّل فعلاً
  // بس مشغول بشغل تاني وقت الفترة المطلوبة — مش محظور/غير مؤهّل.
  availability_status: 'available' | 'schedule_conflicted';
  unavailable_reason_ar: string | null;
  available_again_at: string | null;
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
    pricing_tier: item.pricingTier,
    final_price_cents: estimate ? estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents : null,
    level_price_multiplier: estimate ? estimate.level_price_multiplier : null,
    is_verified: item.isVerified,
    on_time_rate: item.onTimeRatePercent,
    avg_arrival_minutes: item.avgArrivalMinutes,
    is_company: item.isCompany,
    staff_count: item.staffCount,
    branch_count: item.branchCount,
    company_id: item.companyId,
    company_name: item.companyName,
    is_commercial_company: item.isCommercialCompany,
    availability_status: item.availabilityStatus,
    unavailable_reason_ar: item.unavailableReasonAr,
    available_again_at: item.availableAgainAt,
  };
}
