import { TechnicianCategory } from '../../catalog/entities/technician-category.entity';

export interface TechnicianCategoryResponseDto {
  id: string;
  category_id: string;
  verification_status: string;
  is_self_declared: boolean;
  is_active: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  // بس لعرض الأدمن (طابور المراجعة) — الفني نفسه بيعرف بروفايله فمش محتاجهم لبروفايله الذاتي.
  technician_id?: string;
  category_name_ar?: string;
}

export function toTechnicianCategoryResponseDto(
  row: TechnicianCategory,
  extra?: { categoryNameAr?: string; includeTechnicianId?: boolean },
): TechnicianCategoryResponseDto {
  return {
    id: row.id,
    category_id: row.categoryId,
    verification_status: row.verificationStatus,
    is_self_declared: row.isSelfDeclared,
    is_active: row.isActive,
    rejection_reason: row.rejectionReason,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    ...(extra?.includeTechnicianId ? { technician_id: row.technicianId } : {}),
    ...(extra?.categoryNameAr ? { category_name_ar: extra.categoryNameAr } : {}),
  };
}
