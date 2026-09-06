import { TechnicianService } from '../../catalog/entities/technician-service.entity';

export interface TechnicianServiceResponseDto {
  id: string;
  service_id: string;
  skill_level: string;
  verification_status: string;
  is_self_declared: boolean;
  is_active: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  // بس لعرض الأدمن (طابور المراجعة) — الفني نفسه بيعرف بروفايله فمش محتاجهم لبروفايله الذاتي.
  technician_id?: string;
  service_name_ar?: string;
}

export function toTechnicianServiceResponseDto(
  row: TechnicianService,
  extra?: { serviceNameAr?: string; includeTechnicianId?: boolean },
): TechnicianServiceResponseDto {
  return {
    id: row.id,
    service_id: row.serviceId,
    skill_level: row.skillLevel,
    verification_status: row.verificationStatus,
    is_self_declared: row.isSelfDeclared,
    is_active: row.isActive,
    rejection_reason: row.rejectionReason,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    ...(extra?.includeTechnicianId ? { technician_id: row.technicianId } : {}),
    ...(extra?.serviceNameAr ? { service_name_ar: extra.serviceNameAr } : {}),
  };
}
