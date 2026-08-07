import { User } from '../../auth/entities/user.entity';
import { TechnicianProfile } from '../entities/technician-profile.entity';
import { TechnicianDocumentResponseDto, toTechnicianDocumentResponseDto } from './technician-document-response.dto';
import { TechnicianDocument } from '../entities/technician-document.entity';

export interface AdminTechnicianResponseDto {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  technician_code: string;
  years_of_experience: number;
  current_level: string;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  verification_status: string;
  is_available: boolean;
  is_on_duty: boolean;
  created_at: string;
}

export function toAdminTechnicianResponseDto(profile: TechnicianProfile, user: User): AdminTechnicianResponseDto {
  return {
    id: profile.id,
    user_id: profile.userId,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    technician_code: profile.technicianCode,
    years_of_experience: profile.yearsOfExperience,
    current_level: profile.currentLevel,
    quality_score: Number(profile.qualityScore),
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_orders_count: profile.completedOrdersCount,
    cancelled_orders_count: profile.cancelledOrdersCount,
    verification_status: profile.verificationStatus,
    is_available: profile.isAvailable,
    is_on_duty: profile.isOnDuty,
    created_at: profile.createdAt.toISOString(),
  };
}

export interface AdminTechnicianDetailResponseDto extends AdminTechnicianResponseDto {
  documents: TechnicianDocumentResponseDto[];
}

export function toAdminTechnicianDetailResponseDto(
  profile: TechnicianProfile,
  user: User,
  documents: TechnicianDocument[],
): AdminTechnicianDetailResponseDto {
  return {
    ...toAdminTechnicianResponseDto(profile, user),
    documents: documents.map(toTechnicianDocumentResponseDto),
  };
}
