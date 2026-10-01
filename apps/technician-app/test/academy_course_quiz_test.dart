// الأكاديمية: الدرس + الاختبار في التطبيق، والتصحيح في السيرفر (ADR-0117، docs/08 §189 D-3).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/auth_repository.dart';
import 'package:technician_app/features/academy/academy_course_screen.dart';
import 'package:technician_app/features/academy/academy_repository.dart';
import 'package:technician_app/features/academy/models.dart';

class _FakeAcademy extends AcademyRepository {
  _FakeAcademy() : super(AuthRepository());
  final submitted = <List<int>>[];
  bool passNext = false;

  @override
  Future<AcademyQuizResult> submitAttempt(String courseId, List<int> answers) async {
    submitted.add(answers);
    final passed = passNext;
    return AcademyQuizResult(
      score: passed ? 100 : 50,
      correctCount: passed ? 2 : 1,
      total: 2,
      passed: passed,
      results: passed ? [true, true] : [true, false],
      onboarding: AcademyOnboardingStatus(courses: const [], complete: passed, retrainingRequired: false, retrainingReason: null),
    );
  }
}

AcademyCourse _course() => AcademyCourse(
      id: 'c1',
      titleAr: 'التعامل مع العميل وسياسة أسطة',
      titleEn: 'x',
      descriptionAr: null,
      passingScore: 80,
      isMandatoryOnboarding: true,
      lessonAr: 'السعر اللي في التطبيق هو السعر.\n' * 30,
      questions: [
        AcademyQuestion(id: 'q1', promptAr: 'سؤال أول', optionsAr: ['أ', 'ب', 'ج']),
        AcademyQuestion(id: 'q2', promptAr: 'سؤال تاني', optionsAr: ['د', 'هـ', 'و']),
      ],
    );

Future<_FakeAcademy> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(390, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final repo = _FakeAcademy();
  await tester.pumpWidget(MaterialApp(home: AcademyCourseScreen(course: _course(), repository: repo)));
  return repo;
}

void main() {
  testWidgets('تسليم ناقص ⇒ رسالة واضحة والشاشة بتنزل لأول سؤال مش متجاوب، ومفيش نداء للسيرفر', (tester) async {
    final repo = await _pump(tester);
    await tester.scrollUntilVisible(find.byKey(const Key('academy-quiz-submit')), 300);
    await tester.tap(find.text('ب'));
    await tester.pumpAndSettle();
    // السؤال الأول متجاوب؛ نطلع لفوق ونسلّم من غير التاني
    await tester.scrollUntilVisible(find.byKey(const Key('academy-quiz-submit')), 300);
    await tester.tap(find.byKey(const Key('academy-quiz-submit')));
    await tester.pumpAndSettle();
    expect(find.text('جاوب على كل الأسئلة الأول'), findsOneWidget);
    expect(find.text('2. سؤال تاني').hitTestable(), findsOneWidget);
    expect(repo.submitted, isEmpty);
  });

  testWidgets('راسب ⇒ النتيجة وعلامات الغلط و«جرّب تاني» بتمسح الإجابات؛ ناجح ⇒ «تمام»', (tester) async {
    final repo = await _pump(tester);
    await tester.scrollUntilVisible(find.byKey(const Key('academy-quiz-submit')), 300);
    await tester.tap(find.text('ب'));
    await tester.tap(find.text('و'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('academy-quiz-submit')));
    await tester.pumpAndSettle();
    expect(repo.submitted.single, [1, 2]);
    expect(find.byKey(const Key('academy-quiz-result')), findsOneWidget);
    expect(find.textContaining('لسه — 50%'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('2. سؤال تاني'), 300);
    expect(find.byIcon(Icons.cancel), findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);

    await tester.scrollUntilVisible(find.text('جرّب تاني'), -300);
    await tester.tap(find.text('جرّب تاني'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('academy-quiz-result')), findsNothing);

    repo.passNext = true;
    await tester.scrollUntilVisible(find.byKey(const Key('academy-quiz-submit')), 300);
    await tester.tap(find.text('أ'));
    await tester.tap(find.text('د'));
    await tester.pump();
    await tester.tap(find.byKey(const Key('academy-quiz-submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('نجحت — 100%'), findsOneWidget);
    expect(find.text('تمام'), findsOneWidget);
    // بعد النجاح الأسئلة بتختفي
    expect(find.byKey(const Key('academy-quiz-submit')), findsNothing);
  });
}
