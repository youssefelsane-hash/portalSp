// **التمرير الهادي للخطوة الجاية** (docs/08 §189 UX-3) — الوحدة والشاشة الحقيقية.
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/design/reveal_next_section.dart';
import 'package:customer_app/features/orders/schedule_selection_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

Widget _tallPage(GlobalKey target, ScrollController controller, {bool reduceMotion = false}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(size: const Size(390, 600), disableAnimations: reduceMotion),
      child: Scaffold(
        body: SingleChildScrollView(
          controller: controller,
          child: Column(
            children: [
              for (var i = 0; i < 8; i++) SizedBox(height: 120, child: Text('فوق $i')),
              SizedBox(key: target, height: 60, child: const Text('الخطوة الجاية')),
              const SizedBox(height: 900),
            ],
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('بينزل بالقدر اللي يبيّن الجزء الجاي بس (مش لأول الصفحة)', (tester) async {
    tester.view.physicalSize = const Size(390, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final key = GlobalKey();
    final controller = ScrollController();
    await tester.pumpWidget(_tallPage(key, controller));
    expect(controller.offset, 0);

    revealNextSection(key);
    await tester.pumpAndSettle();

    // الهدف بين 960 و1020 ⇒ أقل تمرير يخلّي آخره ظاهر = 1020 − 600 = 420.
    expect(controller.offset, closeTo(420, 1));
    expect(find.text('الخطوة الجاية').hitTestable(), findsOneWidget);
  });

  testWidgets('لو الجزء ظاهر أصلاً مابيتحرّكش خالص', (tester) async {
    tester.view.physicalSize = const Size(390, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final key = GlobalKey();
    final controller = ScrollController();
    await tester.pumpWidget(_tallPage(key, controller));
    controller.jumpTo(700);
    await tester.pump();

    revealNextSection(key);
    await tester.pumpAndSettle();
    expect(controller.offset, 700);
  });

  testWidgets('«تقليل الحركة» في الموبايل ⇒ من غير أنيميشن', (tester) async {
    tester.view.physicalSize = const Size(390, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final key = GlobalKey();
    final controller = ScrollController();
    await tester.pumpWidget(_tallPage(key, controller, reduceMotion: true));

    revealNextSection(key);
    await tester.pump(); // الـpost-frame callback
    await tester.pump(); // من غير أي مدة أنيميشن
    expect(controller.offset, closeTo(420, 1));
  });

  testWidgets('شاشة الميعاد: اختيار اليوم بيبيّن كارت الساعة على موبايل صغير', (tester) async {
    tester.view.physicalSize = const Size(360, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthRepository>(
        create: (_) => AuthRepository(),
        child: const MaterialApp(
          home: ScheduleSelectionScreen(
            allowsDateRangeBooking: true,
            serviceName: 'تكييف',
            warrantyDays: 30,
            requiresPreciseTime: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('اختار يوم محدد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK')); // اليوم الافتراضي في الكالندر
    await tester.pumpAndSettle();

    expect(find.text('حدد وقت البداية').hitTestable(), findsOneWidget);
  });
}
