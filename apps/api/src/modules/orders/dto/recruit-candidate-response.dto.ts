import { RecruitCandidateRow } from '../order-team.service';

export interface RecruitCandidateResponseDto {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  current_level: string;
  average_rating: string;
  distance_km: number | null;
  /** docs/08 §35 — من فريق القائد الدائم؟ بيترتّب أول القايمة (أولوية، مش استبعاد). */
  is_leader_team_member: boolean;
  /** docs/08 §35 — LIGHT = تجنيد فوري، MEANINGFUL/HEAVY = فرصة اختيارية (لن يتم تحميل صامت). */
  capacity_tier: string;
}

export function toRecruitCandidateResponseDto(row: RecruitCandidateRow): RecruitCandidateResponseDto {
  return {
    technician_id: row.technicianId,
    full_name: row.fullName,
    avatar_url: row.avatarUrl,
    current_level: row.currentLevel,
    average_rating: row.averageRating,
    distance_km: row.distanceKm !== null ? Number(row.distanceKm) : null,
    is_leader_team_member: row.isLeaderTeamMember,
    capacity_tier: row.capacityTier,
  };
}
