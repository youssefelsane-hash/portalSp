// فوتر التطبيق (بلاغ مالك 2026-09-11: «الفوتر أصلاً مش ظاهر في الـcustomer application»).
//
// الاختبار ده بيقفل تلات حاجات لازم يفضلوا صح، وكلهم اتكسروا قبل كده في كومبوننتات شبيهة:
//   ١. **بيرسم من غير شبكة**: الفوتر بينده `/legal-entity` و`/social-links` في `initState`.
//      لو الفشل مش متلقّط، الشاشة الرئيسية كلها بتتكسر عند آخرها. هنا مفيش سيرفر خالص —
//      وده بالظبط سيناريو «العميل فاتح التطبيق والنت واقع».
//   ٢. **حقوق الملكية بتفضل ظاهرة** حتى مع فشل الشبكة (سطر قانوني، مش تفصيلة تجميلية).
//   ٣. **صفر overflow على أضيق شاشة واقعية** (320 منطقية) — الفوتر عمودين وفيه نصوص عربية
//      طويلة، وده بالظبط تركيب البَقّة اللي اتلقطت قبل كده في كارت النصايح.
import 'dart:io';

import 'package:customer_app/features/shell/app_footer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _pumpFooter(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    const MaterialApp(
      locale: Locale('ar', 'EG'),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(body: SingleChildScrollView(child: AppFooter())),
      ),
    ),
  );
  // نداءات الشبكة بتفشل (مفيش سيرفر) — الـpump بيدّي الـcatch فرصة يخلص ويرجع القيم المعتمدة.
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('بيرسم من غير سيرفر وبيعرض حقوق الملكية والروابط القانونية', (tester) async {
    await _pumpFooter(tester, const Size(390, 2400));

    expect(find.text('أسطى'), findsWidgets);
    expect(find.textContaining('جميع الحقوق محفوظة'), findsOneWidget);
    expect(find.textContaining('ELSANE Group'), findsWidgets);

    // الشريط القانوني — **حذف الحساب هنا** بالظبط، مش كزرار بارز (نفس قرار الويب).
    expect(find.text('شروط الاستخدام'), findsOneWidget);
    expect(find.text('سياسة الخصوصية'), findsOneWidget);
    expect(find.text('حذف الحساب'), findsOneWidget);

    // أعمدة التنقّل
    expect(find.text('كل الفئات'), findsOneWidget);
    expect(find.text('تواصل معنا'), findsOneWidget);
    expect(find.text('الشكاوى'), findsOneWidget);
    expect(find.text('الضمان'), findsOneWidget);
  });

  testWidgets('صفر overflow على أضيق شاشة واقعية (320 منطقية)', (tester) async {
    await _pumpFooter(tester, const Size(320, 2400));
    expect(tester.takeException(), isNull);
  });

  // لقطة PNG حقيقية للفوتر — نفس نمط `service_card_test.dart`. البلاغ اللي وراه الشغل ده كان
  // **بصري**، و«الاختبار عدّى» مش رد على «شكله بدائي». بتتولّد بـ:
  //   FLUTTER_TEST_FOOTER_PNG=1 flutter test test/app_footer_test.dart --update-goldens
  testWidgets('طباعة لقطة PNG للفوتر (اختياري)', (tester) async {
    if (Platform.environment['FLUTTER_TEST_FOOTER_PNG'] != '1') return;
    tester.view.physicalSize = const Size(390 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const MaterialApp(
        locale: Locale('ar', 'EG'),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(body: SingleChildScrollView(child: AppFooter())),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('app_footer_preview.png'));
  });

  testWidgets('صفر overflow مع تكبير خط النظام لأقصى مدى شائع (×1.5)', (tester) async {
    tester.view.physicalSize = const Size(320, 3200);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        locale: Locale('ar', 'EG'),
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(1.5)),
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(body: SingleChildScrollView(child: AppFooter())),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });
}
