export interface OrderTeamMemberAddedBy {
  type: 'leader' | 'admin';
  name: string;
}

export interface OrderTeamMemberRow {
  id: string;
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  roleLabel: string;
  // 'assistant' = اتوصل عبر مطابقة المساعد التلقائية (ADR-0007)، 'team_member' = إضافة يدوية
  // من قائد الطلب في "اعتماد" (docs/08 §5).
  memberType: string;
  createdAt: Date;
  // كارت رؤية طاقم الطلب للأدمن (docs/08 §35.16) — "مين ضاف مين وإمتى". null نظريًا بس (صف
  // قديم من قبل إضافة العمودين، أو إدخال يدوي مباشر في القاعدة) — كل الأعضاء الجداد من الآن
  // فصاعدًا لازم يكون عندهم واحد من الاتنين (addedByTechnicianId أو addedByAdminUserId).
  addedBy: OrderTeamMemberAddedBy | null;
}

export interface TeamMemberResponseDto {
  id: string;
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  role_label: string;
  member_type: string;
  created_at: string;
  added_by: OrderTeamMemberAddedBy | null;
}

export function toTeamMemberResponseDto(row: OrderTeamMemberRow): TeamMemberResponseDto {
  return {
    id: row.id,
    technician_id: row.technicianId,
    full_name: row.fullName,
    avatar_url: row.avatarUrl,
    role_label: row.roleLabel,
    member_type: row.memberType,
    created_at: row.createdAt.toISOString(),
    added_by: row.addedBy,
  };
}
