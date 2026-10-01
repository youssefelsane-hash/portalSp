import '../../core/auth_repository.dart';
import 'models.dart';

// كانت فجوة موثّقة صراحة في academy.controller.ts نفسه: الـendpoints (كورسات + نتايج
// اختباراتي) شغالة ومختبرة من زمان بس مفيش شاشة في التطبيق كانت بتستخدمها.
class AcademyRepository {
  final AuthRepository auth;

  AcademyRepository(this.auth);

  Future<List<AcademyCourse>> listCourses() async {
    final items = await auth.authedRequestList('/academy/courses');
    return items.map(AcademyCourse.fromJson).toList();
  }

  Future<List<AcademyExamAttempt>> myExamAttempts() async {
    final items = await auth.authedRequestList('/academy/my-exam-attempts');
    return items.map(AcademyExamAttempt.fromJson).toList();
  }

  /// ADR-0117 — الكورسات الإلزامية وإعادة التدريب.
  Future<AcademyOnboardingStatus> onboardingStatus() async {
    final json = await auth.authedRequest('GET', '/academy/onboarding-status');
    return AcademyOnboardingStatus.fromJson(json!);
  }

  /// التطبيق بيبعت رقم الاختيار لكل سؤال بس — التصحيح في السيرفر.
  Future<AcademyQuizResult> submitAttempt(String courseId, List<int> answers) async {
    final json = await auth.authedRequest('POST', '/academy/courses/$courseId/attempts', body: {'answers': answers});
    return AcademyQuizResult.fromJson(json!);
  }
}
