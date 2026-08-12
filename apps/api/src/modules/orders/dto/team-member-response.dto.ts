export interface OrderTeamMemberRow {
  id: string;
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  roleLabel: string;
  createdAt: Date;
}

export interface TeamMemberResponseDto {
  id: string;
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  role_label: string;
  created_at: string;
}

export function toTeamMemberResponseDto(row: OrderTeamMemberRow): TeamMemberResponseDto {
  return {
    id: row.id,
    technician_id: row.technicianId,
    full_name: row.fullName,
    avatar_url: row.avatarUrl,
    role_label: row.roleLabel,
    created_at: row.createdAt.toISOString(),
  };
}
