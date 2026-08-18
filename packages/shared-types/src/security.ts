// مطابق لـ apps/api/src/modules/security/* — Script 5 (SONNA3_Admin_Workforce_Security_Operations.md)
export type SecurityEventType =
  | 'privilege_escalation_attempt'
  | 'unauthorized_role_change'
  | 'unauthorized_permission_grant'
  | 'repeated_permission_denial'
  | 'mfa_failure_burst'
  | 'sensitive_action_denied'
  | 'session_reuse_after_revoke'
  | 'blocked_account_access_attempt'
  | 'security_setting_change';

export type SecurityEventSeverity = 'info' | 'warning' | 'high' | 'critical';

export type SecurityEventStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'false_positive';

export interface SecurityEventDto {
  id: string;
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  status: SecurityEventStatus;
  actorUserId: string | null;
  actorRole: string | null;
  targetUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  action: string | null;
  attemptedValue: Record<string, unknown> | null;
  occurrenceCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  acknowledgedByUserId: string | null;
  acknowledgedAt: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityEventNoteDto {
  id: string;
  securityEventId: string;
  authorUserId: string;
  note: string;
  createdAt: string;
}

export interface SecurityEventListResponse {
  items: SecurityEventDto[];
  meta: { page: number; per_page: number; total: number };
}

export interface SecurityOverviewResponse {
  open_by_severity: { severity: SecurityEventSeverity; count: number }[];
}

export interface ResolveSecurityEventBody {
  status: 'resolved' | 'false_positive';
  resolution_note?: string;
}

export interface AddSecurityEventNoteBody {
  note: string;
}

export type EmployeePresenceState = 'active' | 'idle' | 'offline';

export interface EmployeePresenceDto {
  state: EmployeePresenceState;
  last_activity_at: string | null;
  active_sessions_count: number;
}

export interface WorkforceSummaryRowDto {
  user_id: string;
  full_name: string;
  department: string | null;
  first_login_at: string | null;
  last_activity_at: string | null;
  state: EmployeePresenceState;
  active_seconds_today: number;
  sessions_today: number;
  actions_today: number;
  denied_sensitive_today: number;
  open_alerts: number;
}

export interface EmployeeSessionDto {
  id: string;
  deviceName: string | null;
  devicePlatform: string | null;
  ipAddress: string | null;
  lastSeenAt: string | null;
  lastActivityAt: string | null;
  amr: ('otp' | 'webauthn')[];
  isRevoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
}
