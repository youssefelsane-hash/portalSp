// `LoadingList` — الهيكل العظمي اللي كان بيعمل الشرايط الصفرا (بلاغ المالك 2026-09-11).
//
// كان `Column` ثابت بـ4 عناصر × 80 = 320px من غير تمرير. أول ما الارتفاع المتاح يقلّ عن كده
// (كيبورد مفتوح، شاشة قصيرة، خط نظام مكبّر) بيطلع `RenderFlex overflowed`. وهو مستخدم في
// ٢٦ مكان في التطبيقين — فالبَقّة مكانتش في شاشة واحدة.
import 'package:technician_app/design/loading_list.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// عدّ صناديق الهيكل العظمي نفسها — `FadeTransition` لوحدها بتلقط انتقالات المسارات كمان.
int _skeletonCount(WidgetTester tester) => tester
    .widgetList(find.descendant(
      of: find.byType(LoadingList),
      matching: find.byType(DecoratedBox),
    ))
    .length;

Future<Object?> _renderIn(WidgetTester tester, double height) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SizedBox(height: height, child: const LoadingList()),
      ),
    ),
  );
  await tester.pump();
  return tester.takeException();
}

void main() {
  // 284 = الارتفاع المتاح الحقيقي في شاشة البحث والكيبورد مفتوح (640 − 56 شريط − 300 كيبورد).
  for (final height in [0.0, 20.0, 60.0, 100.0, 180.0, 284.0, 320.0, 400.0, 900.0]) {
    testWidgets('مفيش overflow على ارتفاع $height', (tester) async {
      expect(await _renderIn(tester, height), isNull);
    });
  }

  testWidgets('بيقلّل عدد العناصر لما المساحة تضيق', (tester) async {
    await _renderIn(tester, 900);
    final wide = _skeletonCount(tester);

    await _renderIn(tester, 180);
    final narrow = _skeletonCount(tester);

    expect(wide, 4, reason: 'مساحة واسعة = العدد الكامل زي الأول');
    expect(narrow, lessThan(wide));
    expect(narrow, greaterThanOrEqualTo(1), reason: 'دايمًا فيه مؤشر تحميل مرئي');
  });

  testWidgets('ارتفاع غير مقيّد (جوّه scroll view) = العدد الكامل', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: LoadingList())),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(_skeletonCount(tester), 4);
  });
}
