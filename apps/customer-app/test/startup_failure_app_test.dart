import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_config.dart';
import 'package:customer_app/core/startup_failure_app.dart';

/// **حارس بَقّة 1.0.7+8**: فشل الإقلاع لازم **يترسم** — مش يسيب الـsplash متجمّد لحد ما أندرويد
/// يطلّع «التطبيق لا يستجيب». الاختبار بيستخدم **نفس الاستثناء الحقيقي** اللي رماه الحارس في
/// النسخة المكسورة، مش استثناء مصطنع.
void main() {
  StateError realReleaseMisconfiguration() {
    try {
      assertProductionApiConfig(isRelease: true, url: 'http://10.0.2.2:3000/api/v1');
    } on StateError catch (error) {
      return error;
    }
    fail('الحارس المفروض يرمي على عنوان التطوير في release');
  }

  testWidgets('فشل الإقلاع بيترسم برسالة واضحة بدل شاشة متجمّدة', (tester) async {
    final error = realReleaseMisconfiguration();
    await tester.pumpWidget(StartupFailureApp(error: error));

    expect(find.text('التطبيق مش قادر يشتغل دلوقتي'), findsOneWidget);
    // السبب الفعلي ظاهر — ده اللي بيخلّي المشكلة تتعرف من لقطة شاشة واحدة.
    expect(find.textContaining('10.0.2.2'), findsOneWidget);
  });

  test('الحارس لسه بيرفض عنوان التطوير — الشاشة البديلة مابتضعّفهوش', () {
    expect(
      () => assertProductionApiConfig(isRelease: true, url: 'http://10.0.2.2:3000/api/v1'),
      throwsStateError,
    );
    // وعنوان الإنتاج بيعدّي.
    assertProductionApiConfig(isRelease: true, url: 'https://api.ostahome.com/api/v1');
  });
}
