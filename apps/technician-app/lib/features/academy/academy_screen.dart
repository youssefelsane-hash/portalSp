import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'academy_repository.dart';
import 'models.dart';

// الأكاديمية — كورسات التدريب المتاحة، ونتائج اختباراتي (مسجّلة يدويًا من الأدمن).
class AcademyScreen extends StatefulWidget {
  const AcademyScreen({super.key});

  @override
  State<AcademyScreen> createState() => _AcademyScreenState();
}

class _AcademyScreenState extends State<AcademyScreen> {
  late final AcademyRepository _repository;
  List<AcademyCourse>? _courses;
  List<AcademyExamAttempt>? _attempts;
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
      if (mounted) {
        setState(() {
          _courses = courses;
          _attempts = attempts;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
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
                      Text('الكورسات المتاحة', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      if (_courses!.isEmpty) const EmptyState(icon: Icons.school_outlined, title: 'مفيش كورسات متاحة دلوقتي'),
                      for (final course in _courses!)
                        Card(
                          child: ListTile(
                            title: Text(course.titleAr),
                            subtitle: course.descriptionAr != null ? Text(course.descriptionAr!) : null,
                            trailing: Text('حد النجاح ${course.passingScore}%'),
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
