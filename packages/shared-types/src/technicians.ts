// مطابق لـ apps/api/src/modules/technicians/dto/admin-technician-response.dto.ts وentities/technician-profile.entity.ts
export type TechnicianLevel = 'new' | 'verified' | 'professional' | 'premium' | 'team_leader';

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
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  verification_status: TechnicianVerificationStatus;
  is_available: boolean;
  is_on_duty: boolean;
  created_at: string;
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

export interface AdminTechnicianDetailResponseDto extends AdminTechnicianResponseDto {
  documents: TechnicianDocumentResponseDto[];
}
