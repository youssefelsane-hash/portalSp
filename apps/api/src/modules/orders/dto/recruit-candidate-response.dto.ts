import { RecruitCandidateRow } from '../order-team.service';

export interface RecruitCandidateResponseDto {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  current_level: string;
  average_rating: string;
  distance_km: number | null;
}

export function toRecruitCandidateResponseDto(row: RecruitCandidateRow): RecruitCandidateResponseDto {
  return {
    technician_id: row.technicianId,
    full_name: row.fullName,
    avatar_url: row.avatarUrl,
    current_level: row.currentLevel,
    average_rating: row.averageRating,
    distance_km: row.distanceKm !== null ? Number(row.distanceKm) : null,
  };
}
