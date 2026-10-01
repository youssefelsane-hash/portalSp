// مطابق لـ apps/api/src/modules/academy/dto/*.ts

export interface AcademyCourseResponseDto {
  id: string;
  title_ar: string;
  title_en: string;
  description_ar: string | null;
  passing_score: number;
  display_order: number;
  is_active: boolean;
  /** ADR-0117 */
  course_key?: string | null;
  is_mandatory_onboarding?: boolean;
  question_count?: number;
}

export interface AcademyQuizQuestionForAdmin {
  id: string;
  prompt_ar: string;
  options_ar: string[];
  correct_index: number;
}

export interface AdminAcademyCourseEditResponseDto extends AcademyCourseResponseDto {
  quiz_questions: AcademyQuizQuestionForAdmin[];
}

export interface CreateAcademyCourseBody {
  title_ar: string;
  title_en: string;
  description_ar?: string;
  passing_score?: number;
  display_order?: number;
  is_active?: boolean;
}

export interface UpdateAcademyCourseBody extends Partial<CreateAcademyCourseBody> {
  quiz_questions?: AcademyQuizQuestionForAdmin[];
}

export interface AcademyExamAttemptResponseDto {
  id: string;
  technician_id: string;
  course_id: string;
  score: number;
  passed: boolean;
  attempted_at: string;
  /** ADR-0117 — `self` = امتحن من التطبيق واتصحح في السيرفر. */
  source?: 'admin' | 'self';
}

export interface RecordExamAttemptBody {
  technician_id: string;
  course_id: string;
  score: number;
}

/**
 * ADR-0117 — حالة الكورسات الإلزامية وإعادة التدريب (`GET /academy/onboarding-status` للفني،
 * و`GET /admin/academy/technicians/:id/onboarding-status` للأدمن).
 */
export interface AcademyOnboardingStatus {
  courses: Array<{ course_id: string; title_ar: string; passed: boolean }>;
  complete: boolean;
  retraining_required: boolean;
  retraining_reason: string | null;
}
