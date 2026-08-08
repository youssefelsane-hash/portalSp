export interface CompanyResponseDto {
  id: string;
  owner_user_id: string;
  name: string;
  commercial_registration_number: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CompanyListRowDto extends CompanyResponseDto {
  branch_count: number;
  staff_count: number;
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

export interface StaffMemberResponseDto {
  user_id: string;
  full_name: string;
  technician_code: string;
  team_role: string;
  branch_id: string | null;
  current_level: string;
  verification_status: string;
}

export interface CompanyDetailResponseDto {
  company: CompanyResponseDto;
  branches: BranchResponseDto[];
  staff: StaffMemberResponseDto[];
}
