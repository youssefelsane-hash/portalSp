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
}
