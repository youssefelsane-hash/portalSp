// اختبار دخان بسيط: التطبيق (من غير جلسة محفوظة) لازم يعرض شاشة تسجيل الدخول.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:customer_app/main.dart';

void main() {
  // flutter_secure_storage بيستخدم platform channel حقيقي (Keychain/Keystore) — مش موجود في
  // بيئة اختبار الـ widgets، فلازم نموّهه يدوياً. بيرجع null لكل حاجة (يعني "مفيش جلسة محفوظة"،
  // بالظبط الحالة اللي عايزين نختبرها هنا).
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (MethodCall methodCall) async => null,
    );
  });

  testWidgets('يعرض شاشة تسجيل الدخول لما مفيش جلسة محفوظة', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakApp());
    await tester.pumpAndSettle();

    expect(find.text('صُنّاع'), findsWidgets);
    expect(find.text('ابعت كود التحقق'), findsOneWidget);
  });
}
