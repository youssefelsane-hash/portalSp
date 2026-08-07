import { TechnicianProfile } from '../entities/technician-profile.entity';

export interface TechnicianProfileResponseDto {
  id: string;
  technician_code: string;
  current_level: string;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  verification_status: string;
  is_available: boolean;
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
    verification_status: profile.verificationStatus,
    is_available: profile.isAvailable,
  };
}
