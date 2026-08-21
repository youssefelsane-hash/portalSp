// مطابق لـ apps/api/src/modules/technicians/dto/admin-technician-response.dto.ts وentities/technician-profile.entity.ts
export type TechnicianLevel = 'new' | 'verified' | 'professional' | 'premium' | 'team_leader';

// فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — منفصلة تمامًا عن TechnicianLevel التشغيلي فوق.
export type TechnicianPricingTier = 'standard' | 'expert' | 'senior' | 'premium';

export type TechnicianVerificationStatus =
  | 'pending'
  | 'documents_submitted'
  | 'under_review'
  | 'interview_scheduled'
  | 'test_passed'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type DocumentReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AdminTechnicianResponseDto {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  technician_code: string;
  years_of_experience: number;
  current_level: TechnicianLevel;
  pricing_tier: TechnicianPricingTier;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  verification_status: TechnicianVerificationStatus;
  is_available: boolean;
  is_on_duty: boolean;
  has_current_location: boolean;
  created_at: string;
  assistant_link_status: 'none' | 'pending_approval' | 'approved';
  assistant_technician_id: string | null;
}

export interface TechnicianDocumentResponseDto {
  id: string;
  document_type: string;
  file_url: string;
  review_status: DocumentReviewStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// مطابق لـ apps/api/src/modules/technicians/dto/certificate-response.dto.ts's CertificateResponseDto
// (نسخة الأدمن — بتفاصيل المراجعة كاملة، مختلفة عن PublicCertificateResponseDto المحدودة للعميل).
export interface CertificateResponseDto {
  id: string;
  title: string;
  issuer_name: string | null;
  issued_at: string | null;
  file_url: string;
  review_status: DocumentReviewStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AdminTechnicianDetailResponseDto extends AdminTechnicianResponseDto {
  documents: TechnicianDocumentResponseDto[];
  certificates: CertificateResponseDto[];
}

// مطابق لـ apps/api/src/modules/technicians/dto/technician-zone-response.dto.ts
export interface TechnicianZoneResponseDto {
  id: string;
  technician_id: string;
  service_zone_id: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AssignTechnicianZoneBody {
  service_zone_id: string;
  is_primary?: boolean;
}

// تصريح مهارات ذاتي (Script 4 §2-7) — مطابق لـ
// apps/api/src/modules/technicians/dto/technician-service-response.dto.ts.
export type TechnicianServiceVerificationStatus = 'pending_verification' | 'approved' | 'rejected' | 'suspended';

export interface TechnicianServiceResponseDto {
  id: string;
  service_id: string;
  skill_level: 'beginner' | 'standard' | 'expert';
  verification_status: TechnicianServiceVerificationStatus;
  is_self_declared: boolean;
  is_active: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

// نسخة طابور المراجعة (GET /admin/technicians/service-declarations) — بأسماء الفني/الخدمة
// محلولة، مش UUIDs خام (بيتحسبوا بـjoin واحد في admin-technicians.service.ts، صفر N+1).
export interface AdminTechnicianServiceDeclarationResponseDto extends TechnicianServiceResponseDto {
  technician_id: string;
  technician_code: string;
  technician_full_name: string;
  service_name_ar: string;
}

export interface ApproveTechnicianServiceBody {
  skill_level?: 'beginner' | 'standard' | 'expert';
}

// أهلية بمستوى الفئة/التخصص (ADR-0018 §8، §29) — مطابق لـ
// apps/api/src/modules/technicians/dto/technician-category-response.dto.ts. بديل "مهاراتي"
// خدمة-بخدمة فوق — الفني/الأدمن بيتعاملوا بالفئة الكبيرة (سباكة/كهرباء/...) مش خدمة فردية.
export interface TechnicianCategoryResponseDto {
  id: string;
  category_id: string;
  verification_status: TechnicianServiceVerificationStatus;
  is_self_declared: boolean;
  is_active: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  technician_id?: string;
  category_name_ar?: string;
}

// نسخة طابور المراجعة (GET /admin/technicians/category-declarations).
export interface AdminTechnicianCategoryDeclarationResponseDto extends TechnicianCategoryResponseDto {
  technician_id: string;
  technician_code: string;
  technician_full_name: string;
  category_name_ar: string;
}

export interface SelfDeclareCategoryBody {
  category_id: string;
}

export interface RejectTechnicianServiceBody {
  reason: string;
}

// مطابق لـ apps/api/src/modules/technicians/admin-technicians.controller.ts (GET
// /admin/technicians/by-category) — مركز عمليات فئة (docs/08 §35.9)، مُستخدَم كمان في مصفوفة
// القوى العاملة بفلتر zone_id إضافي (docs/08 §36.3).
export type TechnicianCapacityTier = 'LIGHT' | 'MEANINGFUL' | 'HEAVY' | 'BLOCKED';

// ملحوظة: الـcontroller بيرجّع {items, meta} — بس ResponseInterceptor في apps/api بيكتشف الشكل
// ده تلقائيًا وبيفكّه (items → envelope.data مباشرة، meta → envelope.meta) — استخدم
// authedFetchPaginated<AdminCategoryOpsRowDto>() في apps/admin، مش authedFetch عادي (راجع
// apps/admin/src/lib/api-client.ts تعليق apiFetchPaginated).
export interface AdminCategoryOpsRowDto {
  id: string;
  technician_code: string;
  full_name: string;
  phone_number: string;
  verification_status: TechnicianVerificationStatus;
  current_level: TechnicianLevel;
  online: boolean;
  last_active_at: string | null;
  working_now: boolean;
  capacity_tier_today: TechnicianCapacityTier;
  open_requests_count: number;
  crew_leader_shortage_count: number;
  crew_recruit_open_offers_count: number;
  zone_count: number;
  category_count: number;
  has_zone_issue: boolean;
  has_category_issue: boolean;
}
