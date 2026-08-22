import { TechnicianCompanyBranch } from '../entities/technician-company-branch.entity';
import { TechnicianCompany } from '../entities/technician-company.entity';
import { TechnicianProfile } from '../entities/technician-profile.entity';

export interface CompanyResponseDto {
  id: string;
  owner_user_id: string;
  name: string;
  commercial_registration_number: string | null;
  is_active: boolean;
  created_at: string;
}

export function toCompanyResponseDto(company: TechnicianCompany): CompanyResponseDto {
  return {
    id: company.id,
    owner_user_id: company.ownerUserId,
    name: company.name,
    commercial_registration_number: company.commercialRegistrationNumber,
    is_active: company.isActive,
    created_at: company.createdAt.toISOString(),
  };
}

// "اعتماد" (docs/06 §1.5) — نسخة عامة للعميل، من غير owner_user_id/commercial_registration_number
// (بيانات إدارية داخلية مالهاش داعي تتعرض للعميل وقت اختيار شركة يحجزها).
export interface PublicCompanyResponseDto {
  id: string;
  name: string;
  branch_count: number;
  staff_count: number;
  // صورة الشركة (ADR-0031) — أفتار المالك المعتمد نفسه، مفيش رفع منفصل للشركة. الرابط بيتفك طازة
  // في الـcontroller (resolveAvatarUrl) قبل ما يتحط هنا — راجع company-response.dto.ts caller.
  avatar_url: string | null;
}

export function toPublicCompanyResponseDto(
  company: TechnicianCompany,
  branchCount: number,
  staffCount: number,
  ownerAvatarUrl: string | null,
): PublicCompanyResponseDto {
  return {
    id: company.id,
    name: company.name,
    branch_count: branchCount,
    staff_count: staffCount,
    avatar_url: ownerAvatarUrl,
  };
}

export interface BranchResponseDto {
  id: string;
  company_id: string;
  name: string;
  area_id: string | null;
  address_line: string | null;
  is_active: boolean;
  created_at: string;
}

export function toBranchResponseDto(branch: TechnicianCompanyBranch): BranchResponseDto {
  return {
    id: branch.id,
    company_id: branch.companyId,
    name: branch.name,
    area_id: branch.areaId,
    address_line: branch.addressLine,
    is_active: branch.isActive,
    created_at: branch.createdAt.toISOString(),
  };
}

export interface StaffMemberResponseDto {
  user_id: string;
  full_name: string;
  technician_code: string;
  team_role: string;
  branch_id: string | null;
  current_level: string;
  verification_status: string;
}

export function toStaffMemberResponseDto(profile: TechnicianProfile, fullName: string): StaffMemberResponseDto {
  return {
    user_id: profile.userId,
    full_name: fullName,
    technician_code: profile.technicianCode,
    team_role: profile.teamRole,
    branch_id: profile.branchId,
    current_level: profile.currentLevel,
    verification_status: profile.verificationStatus,
  };
}

export interface CompanyDetailResponseDto {
  company: CompanyResponseDto;
  branches: BranchResponseDto[];
  staff: StaffMemberResponseDto[];
}

// مساحة عمل الشركة (ADR-0033) — صف خام من استعلام TechnicianCompaniesService.listOrders() (SQL
// مباشر، مش TypeORM entity — orders.assigned_company_id مالوش علاقة مباشرة كـrelation لسه).
export interface CompanyOrderRow {
  id: string;
  orderNumber: string;
  serviceNameAr: string;
  orderStatus: string;
  bookingMode: string;
  scheduledAt: Date | null;
  createdAt: Date;
  technicianName: string | null;
  zoneNameAr: string | null;
  totalAmountCents: number;
}

// صف ملخّص واحد — مش OrderResponseDto الكامل (تفاصيل التنفيذ الكاملة مش لازمة هنا، القائمة دي
// نظرة عامة/متابعة بس، نفس فلسفة docs/adr/0033-company-workspace-orders.md).
export interface CompanyOrderSummaryResponseDto {
  id: string;
  order_number: string;
  service_name_ar: string;
  order_status: string;
  booking_mode: string;
  scheduled_at: string | null;
  created_at: string;
  technician_name: string | null;
  zone_name_ar: string | null;
  total_amount_cents: number;
}

export function toCompanyOrderSummaryResponseDto(row: CompanyOrderRow): CompanyOrderSummaryResponseDto {
  return {
    id: row.id,
    order_number: row.orderNumber,
    service_name_ar: row.serviceNameAr,
    order_status: row.orderStatus,
    booking_mode: row.bookingMode,
    scheduled_at: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
    technician_name: row.technicianName,
    zone_name_ar: row.zoneNameAr,
    total_amount_cents: Number(row.totalAmountCents),
  };
}
