import type { AcademyQuizQuestion } from './entities/academy-course.entity';

/**
 * **شرط «الفني خلّص الكورسات الإلزامية»** (ADR-0117) — مكتوب مرة واحدة، SQL بلا حقن تبعيات، عشان
 * بوابة الاعتماد في `admin-technicians.service.ts` تقراه من غير دورة استيراد بين الموديولين.
 *
 * النجاح بيتحسب **بعد** `retraining_required_at` لو فيه إعادة تدريب: نجاح قديم مايشيلش العلامة.
 */
export interface OnboardingCourseStatus {
  course_id: string;
  title_ar: string;
  passed: boolean;
}

export interface OnboardingStatus {
  courses: OnboardingCourseStatus[];
  complete: boolean;
  retraining_required: boolean;
  retraining_reason: string | null;
}

interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

export async function loadOnboardingStatus(db: Queryable, technicianId: string): Promise<OnboardingStatus> {
  const rows = await db.query<Array<{ course_id: string; title_ar: string; passed: boolean }>>(
    `SELECT c.id AS course_id, c.title_ar,
            EXISTS (
              SELECT 1 FROM academy_exam_attempts a
               WHERE a.technician_id = tp.id AND a.course_id = c.id AND a.passed
                 AND (tp.retraining_required_at IS NULL OR a.attempted_at >= tp.retraining_required_at)
            ) AS passed
       FROM technician_profiles tp
       JOIN academy_courses c ON c.is_mandatory_onboarding AND c.is_active AND c.deleted_at IS NULL
      WHERE tp.id = $1
      ORDER BY c.display_order, c.created_at`,
    [technicianId],
  );
  const [profile] = await db.query<Array<{ retraining_required_at: Date | null; retraining_reason: string | null }>>(
    `SELECT retraining_required_at, retraining_reason FROM technician_profiles WHERE id = $1`,
    [technicianId],
  );
  return {
    courses: rows,
    complete: rows.every((r) => r.passed),
    retraining_required: !!profile?.retraining_required_at,
    retraining_reason: profile?.retraining_reason ?? null,
  };
}

export interface QuizGrade {
  score: number;
  correctCount: number;
  total: number;
  /** صح/غلط لكل سؤال بنفس الترتيب — من غير ما نكشف الإجابة الصح نفسها. */
  results: boolean[];
}

export function gradeQuiz(questions: AcademyQuizQuestion[], answers: number[]): QuizGrade {
  const results = questions.map((q, i) => answers[i] === q.correct_index);
  const correctCount = results.filter(Boolean).length;
  const total = questions.length;
  return { score: total === 0 ? 0 : Math.round((correctCount / total) * 100), correctCount, total, results };
}

/** شكل السؤال اللي بيوصل للتطبيق — من غير `correct_index`. */
export function publicQuestions(questions: AcademyQuizQuestion[]): Array<{ id: string; prompt_ar: string; options_ar: string[] }> {
  return questions.map(({ id, prompt_ar, options_ar }) => ({ id, prompt_ar, options_ar }));
}
