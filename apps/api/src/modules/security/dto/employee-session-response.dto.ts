import { RefreshToken } from '../../auth/entities/refresh-token.entity';

// بَقّة أمنية حقيقية اتلقطت (Script 6 Part 23 — تدقيق حي لمسارات Security): admin-workforce.
// controller كان بيرجّع كيان RefreshToken الخام مباشرة من listSessions() — بما فيه tokenHash
// (مش المفروض يوصل الواجهة خالص، حتى لو مُجزّأ/hashed) وأعمدة داخلية زيادة (userId, deviceId,
// userAgent, expiresAt) مش في EmployeeSessionDto (@baytak/shared-types) أصلاً — DTO mismatch
// حقيقي بين الباك-إند والفرونت. نفس نمط toAuditLogResponseDto() الموجود.
export interface EmployeeSessionResponseDto {
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

export function toEmployeeSessionResponseDto(session: RefreshToken): EmployeeSessionResponseDto {
  return {
    id: session.id,
    deviceName: session.deviceName,
    devicePlatform: session.devicePlatform,
    ipAddress: session.ipAddress,
    lastSeenAt: session.lastSeenAt ? session.lastSeenAt.toISOString() : null,
    lastActivityAt: session.lastActivityAt ? session.lastActivityAt.toISOString() : null,
    amr: session.amr,
    isRevoked: session.isRevoked,
    revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    revokedReason: session.revokedReason,
    createdAt: session.createdAt.toISOString(),
  };
}
