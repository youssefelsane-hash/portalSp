import { TechnicianProfile } from '../entities/technician-profile.entity';

export interface TechnicianProfileResponseDto {
  id: string;
  technician_code: string;
  current_level: string;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  years_of_experience: number;
  bio: string | null;
  verification_status: string;
  is_available: boolean;
  is_on_duty: boolean;
  /**
   * هل الفني سجّل رقمه القومي؟ (ADR-0045، docs/08 §77-E1)
   *
   * **boolean بس — الرقم نفسه ما بيترجعش أبدًا للفني**: هو كتبه فبيعرفه، وإرجاعه بيوسّع سطح
   * التسريب بلا أي فايدة. التطبيق محتاج يعرف يعرض الحقل ولا رسالة «اتسجّل» — والـboolean ده
   * كافي للاتنين.
   */
  national_id_set: boolean;
}

export function toTechnicianProfileResponseDto(profile: TechnicianProfile): TechnicianProfileResponseDto {
  return {
    id: profile.id,
    technician_code: profile.technicianCode,
    current_level: profile.currentLevel,
    quality_score: Number(profile.qualityScore),
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_orders_count: profile.completedOrdersCount,
    cancelled_orders_count: profile.cancelledOrdersCount,
    years_of_experience: profile.yearsOfExperience,
    bio: profile.bio,
    verification_status: profile.verificationStatus,
    is_available: profile.isAvailable,
    // كانت فجوة موثّقة صراحة (Script 4 §8): الفني ميقدرش يشوف/يبدّل حالة "أونلاين" بتاعته —
    // matching.service.ts وassistant-matching.service.ts وtechnician-assignment-guard.service.ts
    // التلاتة بيشترطوا is_available AND is_on_duty معًا، بس الحقل ده كان ناقص من DTO بروفايل
    // الفني نفسه (موجود بالفعل في admin-technician-response.dto.ts للأدمن بس).
    is_on_duty: profile.isOnDuty,
    national_id_set: profile.nationalIdHash !== null,
  };
}
