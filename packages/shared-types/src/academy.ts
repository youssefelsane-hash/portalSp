// مطابق لـ apps/api/src/modules/academy/dto/*.ts

export interface AcademyCourseResponseDto {
  id: string;
  title_ar: string;
  title_en: string;
  description_ar: string | null;
  passing_score: number;
  display_order: number;
  is_active: boolean;
}

export interface CreateAcademyCourseBody {
  title_ar: string;
  title_en: string;
  description_ar?: string;
  passing_score?: number;
  display_order?: number;
  is_active?: boolean;
}

export type UpdateAcademyCourseBody = Partial<CreateAcademyCourseBody>;

export interface AcademyExamAttemptResponseDto {
  id: string;
  technician_id: string;
  course_id: string;
  score: number;
  passed: boolean;
  attempted_at: string;
}

export interface RecordExamAttemptBody {
  technician_id: string;
  course_id: string;
  score: number;
}
