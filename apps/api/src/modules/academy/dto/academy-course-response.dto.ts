import { AcademyCourse } from '../entities/academy-course.entity';

export interface AcademyCourseResponseDto {
  id: string;
  title_ar: string;
  title_en: string;
  description_ar: string | null;
  passing_score: number;
  display_order: number;
  is_active: boolean;
}

export function toAcademyCourseResponseDto(course: AcademyCourse): AcademyCourseResponseDto {
  return {
    id: course.id,
    title_ar: course.titleAr,
    title_en: course.titleEn,
    description_ar: course.descriptionAr,
    passing_score: course.passingScore,
    display_order: course.displayOrder,
    is_active: course.isActive,
  };
}
