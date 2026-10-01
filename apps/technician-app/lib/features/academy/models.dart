// الأكاديمية — كورسات تدريب الفنيين ونتايج اختباراتهم، مطابق لـ
// apps/api/src/modules/academy/dto/*.ts و academy.controller.ts (ADR-0117).

class AcademyQuestion {
  final String id;
  final String promptAr;
  final List<String> optionsAr;

  AcademyQuestion({required this.id, required this.promptAr, required this.optionsAr});

  factory AcademyQuestion.fromJson(Map<String, dynamic> json) => AcademyQuestion(
        id: json['id'] as String,
        promptAr: json['prompt_ar'] as String,
        optionsAr: (json['options_ar'] as List<dynamic>).map((e) => e as String).toList(),
      );
}

class AcademyCourse {
  final String id;
  final String titleAr;
  final String titleEn;
  final String? descriptionAr;
  final int passingScore;
  final bool isMandatoryOnboarding;
  final String? lessonAr;
  final List<AcademyQuestion> questions;

  AcademyCourse({
    required this.id,
    required this.titleAr,
    required this.titleEn,
    required this.descriptionAr,
    required this.passingScore,
    this.isMandatoryOnboarding = false,
    this.lessonAr,
    this.questions = const [],
  });

  bool get hasQuiz => questions.isNotEmpty;

  factory AcademyCourse.fromJson(Map<String, dynamic> json) => AcademyCourse(
        id: json['id'] as String,
        titleAr: json['title_ar'] as String,
        titleEn: json['title_en'] as String,
        descriptionAr: json['description_ar'] as String?,
        passingScore: json['passing_score'] as int,
        // الحقول دي جديدة (ADR-0117) — سيرفر أقدم مابيبعتهاش، فالتطبيق بيفضل شغّال زي الأول.
        isMandatoryOnboarding: json['is_mandatory_onboarding'] as bool? ?? false,
        lessonAr: json['lesson_ar'] as String?,
        questions: ((json['questions'] as List<dynamic>?) ?? const [])
            .map((e) => AcademyQuestion.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class AcademyExamAttempt {
  final String id;
  final String courseId;
  final int score;
  final bool passed;
  final String attemptedAt;

  AcademyExamAttempt({
    required this.id,
    required this.courseId,
    required this.score,
    required this.passed,
    required this.attemptedAt,
  });

  factory AcademyExamAttempt.fromJson(Map<String, dynamic> json) => AcademyExamAttempt(
        id: json['id'] as String,
        courseId: json['course_id'] as String,
        score: json['score'] as int,
        passed: json['passed'] as bool,
        attemptedAt: json['attempted_at'] as String,
      );
}

class AcademyOnboardingCourse {
  final String courseId;
  final String titleAr;
  final bool passed;

  AcademyOnboardingCourse({required this.courseId, required this.titleAr, required this.passed});

  factory AcademyOnboardingCourse.fromJson(Map<String, dynamic> json) => AcademyOnboardingCourse(
        courseId: json['course_id'] as String,
        titleAr: json['title_ar'] as String,
        passed: json['passed'] as bool,
      );
}

/// الكورسات الإلزامية + إعادة التدريب (ADR-0117).
class AcademyOnboardingStatus {
  final List<AcademyOnboardingCourse> courses;
  final bool complete;
  final bool retrainingRequired;
  final String? retrainingReason;

  AcademyOnboardingStatus({
    required this.courses,
    required this.complete,
    required this.retrainingRequired,
    required this.retrainingReason,
  });

  /// فيه حاجة مطلوبة من الفني دلوقتي — البانر بيظهر بس ساعتها.
  bool get needsAction => !complete || retrainingRequired;

  factory AcademyOnboardingStatus.fromJson(Map<String, dynamic> json) => AcademyOnboardingStatus(
        courses: (json['courses'] as List<dynamic>)
            .map((e) => AcademyOnboardingCourse.fromJson(e as Map<String, dynamic>))
            .toList(),
        complete: json['complete'] as bool,
        retrainingRequired: json['retraining_required'] as bool,
        retrainingReason: json['retraining_reason'] as String?,
      );
}

class AcademyQuizResult {
  final int score;
  final int correctCount;
  final int total;
  final bool passed;
  final List<bool> results;
  final AcademyOnboardingStatus onboarding;

  AcademyQuizResult({
    required this.score,
    required this.correctCount,
    required this.total,
    required this.passed,
    required this.results,
    required this.onboarding,
  });

  factory AcademyQuizResult.fromJson(Map<String, dynamic> json) => AcademyQuizResult(
        score: json['score'] as int,
        correctCount: json['correct_count'] as int,
        total: json['total'] as int,
        passed: (json['attempt'] as Map<String, dynamic>)['passed'] as bool,
        results: (json['results'] as List<dynamic>).map((e) => e as bool).toList(),
        onboarding: AcademyOnboardingStatus.fromJson(json['onboarding'] as Map<String, dynamic>),
      );
}
