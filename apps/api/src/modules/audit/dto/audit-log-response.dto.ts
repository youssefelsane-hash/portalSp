import { AuditLog } from '../entities/audit-log.entity';

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

export function toAuditLogResponseDto(log: AuditLog): AuditLogResponseDto {
  return {
    id: log.id,
    actor_user_id: log.actorUserId,
    actor_role: log.actorRole,
    actor_ip: log.actorIp,
    action: log.action,
    entity_type: log.entityType,
    entity_id: log.entityId,
    old_values: log.oldValues,
    new_values: log.newValues,
    request_id: log.requestId,
    created_at: log.createdAt.toISOString(),
  };
}
