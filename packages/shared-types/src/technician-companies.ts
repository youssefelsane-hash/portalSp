export interface CompanyResponseDto {
  id: string;
  owner_user_id: string;
  name: string;
  commercial_registration_number: string | null;
  is_active: boolean;
  // ADR-0039 — علامة التوثيق الزرقاء للشركة. مِنحة إدارية، مستقلة عن is_active.
  is_trust_verified: boolean;
  /** ADR-0042 (docs/08 §64.و) — مضاعف سعر الشغل لحجوزات الشركة دي (1 = السعر الأساسي). */
  price_multiplier: number;
  trust_verified_at: string | null;
  trust_verified_note: string | null;
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

// مساحة عمل الشركة (ADR-0033) — GET /admin/technician-companies/:id/orders و
// GET /technician/company/orders.
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
