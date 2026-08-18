import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0135_security_events.sql — تفاصيل القرار في
// docs/adr/0016-security-events-and-employee-activity.md.
export enum SecurityEventType {
  PRIVILEGE_ESCALATION_ATTEMPT = 'privilege_escalation_attempt',
  UNAUTHORIZED_ROLE_CHANGE = 'unauthorized_role_change',
  UNAUTHORIZED_PERMISSION_GRANT = 'unauthorized_permission_grant',
  REPEATED_PERMISSION_DENIAL = 'repeated_permission_denial',
  MFA_FAILURE_BURST = 'mfa_failure_burst',
  SENSITIVE_ACTION_DENIED = 'sensitive_action_denied',
  SESSION_REUSE_AFTER_REVOKE = 'session_reuse_after_revoke',
  BLOCKED_ACCOUNT_ACCESS_ATTEMPT = 'blocked_account_access_attempt',
  SECURITY_SETTING_CHANGE = 'security_setting_change',
}

export enum SecurityEventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum SecurityEventStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive',
}

@Entity('security_events')
export class SecurityEvent {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'event_type', type: 'enum', enum: SecurityEventType, enumName: 'security_event_type' })
  eventType: SecurityEventType;

  @Column({ type: 'enum', enum: SecurityEventSeverity, enumName: 'security_event_severity' })
  severity: SecurityEventSeverity;

  @Column({ type: 'enum', enum: SecurityEventStatus, enumName: 'security_event_status', default: SecurityEventStatus.OPEN })
  status: SecurityEventStatus;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 60, nullable: true })
  actorRole: string | null;

  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId: string | null;

  @Column({ name: 'target_type', type: 'varchar', length: 60, nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  action: string | null;

  @Column({ name: 'attempted_value', type: 'jsonb', nullable: true })
  attemptedValue: Record<string, unknown> | null;

  @Column({ name: 'occurrence_count', type: 'int', default: 1 })
  occurrenceCount: number;

  @Column({ name: 'first_occurred_at', type: 'timestamptz' })
  firstOccurredAt: Date;

  @Column({ name: 'last_occurred_at', type: 'timestamptz' })
  lastOccurredAt: Date;

  @Column({ name: 'acknowledged_by_user_id', type: 'uuid', nullable: true })
  acknowledgedByUserId: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
