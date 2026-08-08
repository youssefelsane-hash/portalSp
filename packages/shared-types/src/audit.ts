// مطابق لـ apps/api/src/modules/audit/dto/audit-log-response.dto.ts
export interface AuditLogResponseDto {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_ip: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}
