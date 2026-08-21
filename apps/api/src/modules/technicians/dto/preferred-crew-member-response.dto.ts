import { PreferredCrewRow } from '../preferred-crew.service';

export interface PreferredCrewMemberResponseDto {
  id: string;
  technician_id: string;
  technician_code: string;
  full_name: string;
  status: string;
  invited_at: string;
  responded_at: string | null;
}

export function toPreferredCrewMemberResponseDto(row: PreferredCrewRow): PreferredCrewMemberResponseDto {
  return {
    id: row.id,
    technician_id: row.technicianId,
    technician_code: row.technicianCode,
    full_name: row.fullName,
    status: row.status,
    invited_at: row.invitedAt.toISOString(),
    responded_at: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}
