import { AcademyExamAttempt } from '../entities/academy-exam-attempt.entity';

export interface AcademyExamAttemptResponseDto {
  id: string;
  technician_id: string;
  course_id: string;
  score: number;
  passed: boolean;
  attempted_at: string;
}

export function toAcademyExamAttemptResponseDto(attempt: AcademyExamAttempt): AcademyExamAttemptResponseDto {
  return {
    id: attempt.id,
    technician_id: attempt.technicianId,
    course_id: attempt.courseId,
    score: attempt.score,
    passed: attempt.passed,
    attempted_at: attempt.attemptedAt.toISOString(),
  };
}
