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
