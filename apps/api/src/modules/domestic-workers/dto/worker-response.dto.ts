import { DomesticWorkerProfile } from '../entities/domestic-worker-profile.entity';

export interface WorkerResponseDto {
  id: string;
  worker_code: string;
  bio: string | null;
  years_of_experience: number;
  specialties: string[];
  hourly_rate_cents: number | null;
  monthly_rate_cents: number | null;
  verification_status: string;
  verification_notes: string | null;
  is_available: boolean;
  average_rating: number;
  total_ratings_count: number;
  completed_bookings_count: number;
  created_at: string;
}

export function toWorkerResponseDto(profile: DomesticWorkerProfile): WorkerResponseDto {
  return {
    id: profile.id,
    worker_code: profile.workerCode,
    bio: profile.bio,
    years_of_experience: profile.yearsOfExperience,
    specialties: profile.specialties,
    hourly_rate_cents: profile.hourlyRateCents,
    monthly_rate_cents: profile.monthlyRateCents,
    verification_status: profile.verificationStatus,
    verification_notes: profile.verificationNotes,
    is_available: profile.isAvailable,
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_bookings_count: profile.completedBookingsCount,
    created_at: profile.createdAt.toISOString(),
  };
}

/** نسخة عامة تتعرض للعميل وقت التصفّح — بدون تفاصيل مراجعة الأدمن الداخلية. */
export interface PublicWorkerResponseDto {
  id: string;
  worker_code: string;
  full_name: string;
  bio: string | null;
  years_of_experience: number;
  specialties: string[];
  hourly_rate_cents: number | null;
  monthly_rate_cents: number | null;
  average_rating: number;
  total_ratings_count: number;
  completed_bookings_count: number;
  distance_km: number | null;
  // ADR-0030 Slice C — مطابقة لحقول التصفّح المكافئة عند الفني العادي (technician-booking-list-response.dto.ts).
  availability_status: 'available' | 'schedule_conflicted';
  unavailable_reason_ar: string | null;
  available_again_at: string | null;
}

export function toPublicWorkerResponseDto(
  profile: DomesticWorkerProfile,
  fullName: string,
  distanceKm: number | null = null,
  availabilityStatus: 'available' | 'schedule_conflicted' = 'available',
  unavailableReasonAr: string | null = null,
  availableAgainAt: string | null = null,
): PublicWorkerResponseDto {
  return {
    id: profile.id,
    worker_code: profile.workerCode,
    full_name: fullName,
    bio: profile.bio,
    years_of_experience: profile.yearsOfExperience,
    specialties: profile.specialties,
    hourly_rate_cents: profile.hourlyRateCents,
    monthly_rate_cents: profile.monthlyRateCents,
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_bookings_count: profile.completedBookingsCount,
    distance_km: distanceKm,
    availability_status: availabilityStatus,
    unavailable_reason_ar: unavailableReasonAr,
    available_again_at: availableAgainAt,
  };
}
