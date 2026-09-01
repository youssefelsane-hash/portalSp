import 'package:customer_app/features/ratings/rating_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('نافذة التقييم لا تتجاوز عرض شاشة موبايل ضيقة', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    tester.platformDispatcher.textScaleFactorTestValue = 1.25;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => showRatingDialog(context),
              child: const Text('افتح التقييم'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('افتح التقييم'));
    await tester.pumpAndSettle();

    expect(find.text('قيّم الطلب'), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
  });
}
