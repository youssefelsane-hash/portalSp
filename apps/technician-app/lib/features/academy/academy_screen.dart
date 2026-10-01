import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'academy_course_screen.dart';
import 'academy_repository.dart';
import 'models.dart';

// الأكاديمية — كورسات التدريب (الدرس + الاختبار من التطبيق، ADR-0117)، ونتائج اختباراتي.
class AcademyScreen extends StatefulWidget {
  const AcademyScreen({super.key});

  @override
  State<AcademyScreen> createState() => _AcademyScreenState();
}

class _AcademyScreenState extends State<AcademyScreen> {
  late final AcademyRepository _repository;
  List<AcademyCourse>? _courses;
  List<AcademyExamAttempt>? _attempts;
  AcademyOnboardingStatus? _onboarding;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = AcademyRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final courses = await _repository.listCourses();
      final attempts = await _repository.myExamAttempts();
      AcademyOnboardingStatus? onboarding;
      try {
        onboarding = await _repository.onboardingStatus();
      } catch (_) {
        // سيرفر أقدم من ADR-0117 — الشاشة بتشتغل من غير حالة الإلزامي.
      }
      if (mounted) {
        setState(() {
          _courses = courses;
          _attempts = attempts;
          _onboarding = onboarding;
        });
      }
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (mounted) setState(() => _error = err.message);
    }
  }

  bool _passed(AcademyCourse course) {
    for (final c in _onboarding?.courses ?? const <AcademyOnboardingCourse>[]) {
      if (c.courseId == course.id) return c.passed;
    }
    return (_attempts ?? const <AcademyExamAttempt>[]).any((a) => a.courseId == course.id && a.passed);
  }

  Future<void> _openCourse(AcademyCourse course) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => AcademyCourseScreen(course: course, repository: _repository)),
    );
    await _load();
  }

  String _courseTitle(String courseId) {
    for (final course in _courses ?? const <AcademyCourse>[]) {
      if (course.id == courseId) return course.titleAr;
    }
    return courseId;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('الأكاديمية')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _error != null
            ? Center(child: Text(_error!))
            : _courses == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_onboarding?.retrainingRequired == true)
                        Card(
                          key: const Key('academy-retraining-notice'),
                          color: Theme.of(context).colorScheme.errorContainer,
                          child: ListTile(
                            leading: const Icon(Icons.replay),
                            title: const Text('مطلوب منك تعيد الكورس الإلزامي'),
                            subtitle: Text(
                              'السبب: ${_onboarding!.retrainingReason ?? 'تقييم أو شكوى على الأسلوب'}. ده مش إيقاف — العلامة بتتشال أول ما تنجح.',
                            ),
                          ),
                        ),
                      Text('الكورسات المتاحة', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      if (_courses!.isEmpty) const EmptyState(icon: Icons.school_outlined, title: 'مفيش كورسات متاحة دلوقتي'),
                      for (final course in _courses!)
                        Card(
                          child: ListTile(
                            title: Row(
                              children: [
                                Flexible(child: Text(course.titleAr)),
                                if (course.isMandatoryOnboarding) ...[
                                  const SizedBox(width: 8),
                                  const Chip(label: Text('إلزامي'), visualDensity: VisualDensity.compact),
                                ],
                              ],
                            ),
                            subtitle: course.descriptionAr != null ? Text(course.descriptionAr!) : null,
                            trailing: course.hasQuiz
                                ? (_passed(course) && _onboarding?.retrainingRequired != true
                                    ? const Icon(Icons.check_circle, color: Colors.green)
                                    : const Icon(Icons.chevron_left))
                                : Text('حد النجاح ${course.passingScore}%'),
                            onTap: course.hasQuiz || course.lessonAr != null ? () => _openCourse(course) : null,
                          ),
                        ),
                      const SizedBox(height: 24),
                      Text('نتائج اختباراتي', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      if (_attempts == null)
                        const LoadingList(itemCount: 2)
                      else if (_attempts!.isEmpty)
                        const EmptyState(icon: Icons.fact_check_outlined, title: 'مفيش نتائج اختبارات مسجّلة لسه')
                      else
                        for (final attempt in _attempts!)
                          Card(
                            child: ListTile(
                              title: Text(_courseTitle(attempt.courseId)),
                              subtitle: Text(attempt.attemptedAt.split('T').first),
                              trailing: Chip(
                                label: Text('${attempt.score}% — ${attempt.passed ? 'ناجح' : 'راسب'}'),
                                backgroundColor: attempt.passed ? Colors.green.shade100 : Colors.red.shade100,
                              ),
                            ),
                          ),
                    ],
                  ),
      ),
    );
  }
}
