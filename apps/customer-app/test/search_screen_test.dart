// شاشة البحث — بلاغ المالك 2026-09-11:
// «خانة السيرش فيها overflow في البيكسلز… عايزين ما يبقاش ظاهر الحتة بتاعت الأصفر والأسود دي.
//  وبرضه السيرش المفروض يبقى بيعرض كل حاجة افتراضيًا ويفلتر مع الكتابة… وثانية واحدة بين
//  كل حرف والتاني عشان الموقع ما يسحبش requests كتير».
//
// الـoverflow اتقاس فعليًا قبل الإصلاح: الحالة الفاضية كانت `Center` جوّه `Scaffold.body`،
// والشاشة كانت `autofocus` فالكيبورد بيفتح تلقائيًا وياخد ~300px من الارتفاع المتاح.
// مع تكبير خط النظام النتيجة كانت `A RenderFlex overflowed by 62 pixels on the bottom`.
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/catalog/search_results_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<Object?> _render(
  WidgetTester tester, {
  required double height,
  required double keyboard,
  required double scale,
}) async {
  tester.view.physicalSize = Size(390, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light(),
      home: MediaQuery(
        data: MediaQueryData(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: const SearchResultsScreen(),
      ),
    ),
  );
  // مفيش سيرفر في الاختبار — `_loadAll` بيفشل وبيرجع قايمة فاضية، وده بيعرض الحالة الفاضية
  // (أطول محتوى ثابت في الشاشة، وهي بالظبط اللي كانت بتعمل overflow).
  await tester.pump(const Duration(seconds: 1));
  return tester.takeException();
}

void main() {
  group('صفر overflow مهما كان الكيبورد ومقياس الخط', () {
    // كيبورد أندرويد الحقيقي ~280–340 بكسل منطقي.
    for (final height in [640.0, 740.0, 844.0]) {
      for (final keyboard in [0.0, 300.0, 340.0]) {
        for (final scale in [1.0, 1.3, 1.6]) {
          testWidgets('h=$height kb=$keyboard scale=$scale', (tester) async {
            expect(
              await _render(tester, height: height, keyboard: keyboard, scale: scale),
              isNull,
            );
          });
        }
      }
    }
  });

  testWidgets('مفيش كيبورد بيفتح تلقائيًا — المحتوى هو اللي يتشاف الأول', (tester) async {
    await _render(tester, height: 844, keyboard: 0, scale: 1.0);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.autofocus, isFalse);
  });

  test('المهلة بين الحروف ثانية واحدة (طلب المالك الصريح)', () {
    expect(kSearchDebounce, const Duration(seconds: 1));
  });
}
