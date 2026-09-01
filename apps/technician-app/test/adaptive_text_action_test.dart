import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/design/adaptive_text_action.dart';

void main() {
  testWidgets('زر إجراء الدخول لا يتجاوز شاشة ضيقة مع خط كبير', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await tester.pumpWidget(
      const MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: Padding(
              padding: EdgeInsets.all(24),
              child: AdaptiveTextAction(
                label: 'تقدر تطلب كود جديد بعد 30 ثانية',
                icon: Icons.refresh_rounded,
                onPressed: null,
              ),
            ),
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('تقدر تطلب كود جديد بعد 30 ثانية'), findsOneWidget);
  });
}
