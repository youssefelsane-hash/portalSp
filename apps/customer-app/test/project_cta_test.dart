// كارت «ابدأ مشروع» — بلاغ المالك 2026-09-11: «طويل وعريض أوي… قلّل ارتفاعه عشان ما ياكلش
// الشاشة… شيل لوجو البيت… خليه بريميوم».
//
// الاختبار ده بيقيس **الارتفاع الحقيقي بعد الرندر**. «شكله بقى أحسن» مش حاجة تتقاس، لكن
// «الكارت بياكل قد إيه من الشاشة» تتقاس بالظبط — وهي دي شكوى المالك الفعلية.
import 'package:customer_app/features/catalog/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<double> _ctaHeight(WidgetTester tester, {double textScale = 1.0}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      locale: const Locale('ar', 'EG'),
      home: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
        child: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: Align(
              alignment: Alignment.topCenter,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: ProjectCtaCard(onTap: () {}),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  return tester.getSize(find.byType(ProjectCtaCard)).height;
}

void main() {
  testWidgets('ارتفاع الكارت ٦٢px بدل ١٨٢px (متقاس على 390×844)', (tester) async {
    expect(await _ctaHeight(tester), lessThan(75));
  });

  testWidgets('مع تكبير خط النظام ×1.5: ٨٠px بدل ٢٧٢px', (tester) async {
    // من غير maxLines الكارت كان بيرجع يطول تاني هنا بالظبط.
    expect(await _ctaHeight(tester, textScale: 1.5), lessThan(95));
    expect(tester.takeException(), isNull);
  });

  testWidgets('مفيش إيموچي في النص', (tester) async {
    await _ctaHeight(tester);
    final texts = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '');
    for (final text in texts) {
      expect(
        RegExp(r'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]', unicode: true).hasMatch(text),
        isFalse,
        reason: 'الإيموچي شكله بيختلف من جهاز لجهاز ومفيش تحكّم فيه: «$text»',
      );
    }
  });

  testWidgets('الدوسة بتوصل', (tester) async {
    var tapped = false;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(body: ProjectCtaCard(onTap: () => tapped = true)),
        ),
      ),
    );
    await tester.tap(find.byType(ProjectCtaCard));
    await tester.pump();
    expect(tapped, isTrue);
  });
}
