import 'package:customer_app/features/ratings/rating_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// بلاغ مالك (2026-09-03): «أي حد ييجي يبعت التقييم بتيجي شاشة حمرا — التقييم بيتبعت وكل حاجة
// بس الشاشة الحمرا بتظهر». الاختبار ده بيعيد إنتاج اللحظة دي بالظبط: فتح الحوار، كتابة تعليق
// (عشان الـEditableText يبقى حي فعلاً)، ودوس «إرسال» — وبعدها انتظار انتهاء أنيميشن الخروج.
void main() {
  testWidgets('إرسال التقييم مايرميش استثناء بعد قفل الحوار', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));

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

    await tester.enterText(find.byType(TextField).first, 'شغل ممتاز');
    await tester.pump();

    await tester.tap(find.text('إرسال'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
  });
}
