import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import 'academy_repository.dart';
import 'models.dart';

/// الدرس + الاختبار في شاشة واحدة (ADR-0117). الفني بيقرا، يجاوب، والسيرفر هو اللي بيصحح.
/// بترجّع `true` لو نجح عشان الشاشة اللي قبلها تحدّث حالتها.
class AcademyCourseScreen extends StatefulWidget {
  final AcademyCourse course;
  final AcademyRepository repository;

  const AcademyCourseScreen({super.key, required this.course, required this.repository});

  @override
  State<AcademyCourseScreen> createState() => _AcademyCourseScreenState();
}

class _AcademyCourseScreenState extends State<AcademyCourseScreen> {
  late final List<int?> _answers = List<int?>.filled(widget.course.questions.length, null);
  late final List<GlobalKey> _questionKeys = List.generate(widget.course.questions.length, (_) => GlobalKey());
  AcademyQuizResult? _result;
  bool _submitting = false;
  String? _error;

  // سؤال ناقص ⇒ الشاشة بتنزل له بهدوء بدل رسالة عامة (نفس قاعدة «أول حاجة ناقصة»، docs/08 §189 UX-3).
  void _revealFirstUnanswered() {
    final index = _answers.indexWhere((a) => a == null);
    if (index < 0) return;
    final target = _questionKeys[index].currentContext;
    if (target == null) return;
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    Scrollable.ensureVisible(
      target,
      duration: reduceMotion ? Duration.zero : const Duration(milliseconds: 380),
      curve: Curves.easeOutCubic,
      alignment: 0.1,
    );
  }

  Future<void> _submit() async {
    if (_answers.contains(null)) {
      setState(() => _error = 'جاوب على كل الأسئلة الأول');
      _revealFirstUnanswered();
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await widget.repository.submitAttempt(widget.course.id, _answers.cast<int>());
      if (!mounted) return;
      setState(() => _result = result);
    } catch (errRaw) {
      if (mounted) setState(() => _error = ApiException.from(errRaw).message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _retry() {
    setState(() {
      _result = null;
      for (var i = 0; i < _answers.length; i++) {
        _answers[i] = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final course = widget.course;
    final theme = Theme.of(context);
    final result = _result;
    return Scaffold(
      appBar: AppBar(title: Text(course.titleAr)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (course.lessonAr != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(course.lessonAr!, style: theme.textTheme.bodyLarge?.copyWith(height: 1.6)),
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (result != null)
            Card(
              key: const Key('academy-quiz-result'),
              color: result.passed ? Colors.green.shade50 : Colors.orange.shade50,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      result.passed ? 'نجحت — ${result.score}%' : 'لسه — ${result.score}% (النجاح من ${course.passingScore}%)',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 4),
                    Text('${result.correctCount} إجابة صح من ${result.total}.'),
                    if (!result.passed) ...[
                      const SizedBox(height: 4),
                      const Text('راجع الدرس فوق، والأسئلة اللي عليها علامة حمرا، وجرّب تاني.'),
                    ],
                    const SizedBox(height: 12),
                    if (result.passed)
                      FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('تمام'))
                    else
                      OutlinedButton(onPressed: _retry, child: const Text('جرّب تاني')),
                  ],
                ),
              ),
            ),
          if (course.hasQuiz && (result == null || !result.passed)) ...[
            Text('الاختبار — ${course.questions.length} أسئلة', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            for (var i = 0; i < course.questions.length; i++)
              Card(
                key: _questionKeys[i],
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: [
                            Expanded(child: Text('${i + 1}. ${course.questions[i].promptAr}', style: theme.textTheme.titleSmall)),
                            if (result != null)
                              Icon(
                                result.results[i] ? Icons.check_circle : Icons.cancel,
                                color: result.results[i] ? Colors.green : Colors.red,
                              ),
                          ],
                        ),
                      ),
                      RadioGroup<int>(
                        groupValue: _answers[i],
                        onChanged: (value) {
                          if (result != null) return;
                          setState(() {
                            _answers[i] = value;
                            if (!_answers.contains(null)) _error = null;
                          });
                        },
                        child: Column(
                          children: [
                            for (var o = 0; o < course.questions[i].optionsAr.length; o++)
                              RadioListTile<int>(
                                value: o,
                                title: Text(course.questions[i].optionsAr[o]),
                                dense: true,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (result == null)
              FilledButton(
                key: const Key('academy-quiz-submit'),
                onPressed: _submitting ? null : _submit,
                child: Text(_submitting ? 'بيتصحح...' : 'سلّم الإجابات'),
              ),
          ],
        ],
      ),
    );
  }
}
