// الأكاديمية — كورسات تدريب الفنيين ونتايج اختباراتهم، مطابق لـ
// apps/api/src/modules/academy/dto/*.ts.

class AcademyCourse {
  final String id;
  final String titleAr;
  final String titleEn;
  final String? descriptionAr;
  final int passingScore;

  AcademyCourse({
    required this.id,
    required this.titleAr,
    required this.titleEn,
    required this.descriptionAr,
    required this.passingScore,
  });

  factory AcademyCourse.fromJson(Map<String, dynamic> json) => AcademyCourse(
        id: json['id'] as String,
        titleAr: json['title_ar'] as String,
        titleEn: json['title_en'] as String,
        descriptionAr: json['description_ar'] as String?,
        passingScore: json['passing_score'] as int,
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
