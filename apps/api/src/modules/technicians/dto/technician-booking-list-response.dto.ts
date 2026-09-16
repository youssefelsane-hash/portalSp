import { PriceEstimate } from '../../catalog/catalog.service';
import { TechnicianBookingListItem } from '../technicians.service';
import {
  ArrivalMetricMode,
  isExpectedArrivalDisplayable,
  isPunctualityDisplayable,
} from '../technician-arrival-metrics';

export interface TechnicianBookingListItemResponseDto {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  average_rating: number;
  total_ratings_count: number;
  /**
   * **طلبات الفني في الخدمة دي وحدها** — مش إجماليه على المنصّة (ده `total_completed_count`).
   *
   * الاسم القديم كان بيوحي إنه الإجمالي، فكارت العميل كان بيعرض «0 طلب مكتمل» جنب «4.4 (5)»
   * — تقييمات عامة جنب عدّاد خاص بالخدمة، وده بيقرا كتناقض (docs/08 §153).
   */
  service_completed_count: number;
  /** إجمالي شغل الفني على المنصّة كلها. */
  total_completed_count: number;
  distance_km: number | null;
  // مضاعف سعر مستوى الفني (docs/08) — العميل لازم يشوف رتبة الفني والسعر النهائي المحسوب فعليًا
  // بيها قبل ما يختاره، مش بعد التأكيد. final_price_cents = null لخدمات pricing_model=formula
  // (المضاعف مش بيتطبّق عليها أصلاً، وتفصيل السعر محتاج field_values مش متاحة في القايمة دي).
  technician_level: string;
  /**
   * اسم المستوى المعروض **زي ما الأدمن ضابطه**. `null` للشركات (مالهاش مستوى).
   *
   * التطبيق كان عنده خريطة ثابتة (`premium` ⇒ «مميز») والأدمن ضابط «بريميوم» — قيمتين لنفس
   * الحاجة، وأي تعديل من اللوحة مكانش بيوصل للعميل (docs/08 §153).
   */
  technician_level_label_ar: string | null;
  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — مستقلة عن technician_level فوق، بتتبعت
  // نفس نمط الشفافية (final_price_cents/level_price_multiplier) عشان العميل/الدعم يقدروا يفهموا
  // أساس السعر المعروض بالظبط.
  pricing_tier: string;
  final_price_cents: number | null;
  level_price_multiplier: number | null;
  is_verified: boolean;
  /**
   * **مؤشر الوصول — مفهومين حسب أفق الطلب** (ADR-0099، docs/08 §153).
   *
   * السيرفر هو اللي بيقرر مين المعروض، فالواجهات مابتشتقش القاعدة بنفسها ومستحيل يعرضوا
   * مؤشرين مختلفين لنفس الطلب. الحقول اللي مش بتاعة الوضع الحالي بترجع `null` صراحةً.
   */
  arrival_metric_mode: ArrivalMetricMode;
  /** الطلب فوري/قريب: متوسط مدة الانتقال في نفس النطاق (دقايق). `null` = مفيش رقم يستاهل العرض. */
  expected_arrival_minutes: number | null;
  /** الطلب مجدول: الالتزام بالمواعيد. `null` = العيّنة أصغر من إنها تتعرض. */
  punctuality: {
    on_time_rate: number;
    /** عدد الزيارات اللي النسبة اتحسبت منها — الواجهة بتعرضه عشان الرقم يبقى مفهوم. */
    sample_count: number;
    /** متوسط التأخير بالدقايق على الزيارات المتأخرة وحدها. `null` = مفيش تأخير مسجّل. */
    average_late_minutes: number | null;
  } | null;
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
  arrival: { mode: ArrivalMetricMode; minPunctualitySample: number },
): TechnicianBookingListItemResponseDto {
  const punctualityStats = {
    onTimeRatePercent: item.onTimeRatePercent,
    averageLateMinutes: item.avgLateMinutes,
    sampleCount: item.onTimeSampleCount,
  };
  // القيم اللي مش بتاعة الوضع الحالي بترجع `null` **من السيرفر** — مش بتتبعت وتتجاهل في
  // الواجهة. كده مستحيل واجهة تعرض ETA لطلب بعد أسبوع لأن الرقم أصلاً مش بيوصلها.
  const showExpectedArrival =
    arrival.mode === 'expected_arrival' && isExpectedArrivalDisplayable(item.avgArrivalMinutes);
  const showPunctuality =
    arrival.mode === 'punctuality' && isPunctualityDisplayable(punctualityStats, arrival.minPunctualitySample);
  return {
    id: item.technicianId,
    full_name: item.fullName,
    avatar_url: item.avatarUrl,
    bio: item.bio,
    average_rating: item.averageRating,
    total_ratings_count: item.totalRatingsCount,
    service_completed_count: item.serviceCompletedCount,
    total_completed_count: item.totalCompletedCount,
    distance_km: item.distanceKm !== null ? Math.round(item.distanceKm * 100) / 100 : null,
    technician_level: item.currentLevel,
    technician_level_label_ar: item.currentLevelLabelAr,
    pricing_tier: item.pricingTier,
    final_price_cents: estimate ? estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents : null,
    level_price_multiplier: estimate ? estimate.level_price_multiplier : null,
    is_verified: item.isVerified,
    arrival_metric_mode: arrival.mode,
    expected_arrival_minutes: showExpectedArrival ? item.avgArrivalMinutes : null,
    punctuality: showPunctuality
      ? {
          on_time_rate: punctualityStats.onTimeRatePercent!,
          sample_count: punctualityStats.sampleCount,
          average_late_minutes: punctualityStats.averageLateMinutes,
        }
      : null,
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
