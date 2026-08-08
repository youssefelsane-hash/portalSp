// اختبار دخان بسيط: التطبيق (من غير جلسة محفوظة) لازم يعرض شاشة تسجيل الدخول.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:technician_app/main.dart';

void main() {
  // flutter_secure_storage بيستخدم platform channel حقيقي (Keychain/Keystore) — مش موجود في
  // بيئة اختبار الـ widgets، فلازم نموّهه يدوياً. بيرجع null لكل حاجة (يعني "مفيش جلسة محفوظة"،
  // بالظبط الحالة اللي عايزين نختبرها هنا).
  const secureStorageChannel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  // safe_device (فحص root/jailbreak، `core/device_security.dart`) نفس القصة — بس لازم نموّه كمان
  // `init` نفسها (بتتنادى من غير await/catch جوّه الـ package، فلو رجعت MissingPluginException
  // من غير mock هنا بتظهر كـ uncaught exception بتفشّل الاختبار كله، مش بس الفحص). بترجع "جهاز
  // حقيقي وسليم" هنا عشان الاختبار يوصل لشاشة الدخول — سلوك الفحص الحقيقي نفسه (native) مش قابل
  // للاختبار في البيئة دي أصلاً (نفس قيد كل حاجة تانية محتاجة جهاز/إيموليتور حقيقي).
  const safeDeviceChannel = MethodChannel('safe_device');
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      secureStorageChannel,
      (MethodCall methodCall) async => null,
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      safeDeviceChannel,
      (MethodCall methodCall) async {
        switch (methodCall.method) {
          case 'isRealDevice':
            return true;
          case 'isJailBroken':
            return false;
          default:
            return null;
        }
      },
    );
  });

  testWidgets('يعرض شاشة تسجيل الدخول لما مفيش جلسة محفوظة', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakTechnicianApp());
    await tester.pumpAndSettle();

    expect(find.text('baytak'), findsWidgets);
    expect(find.text('ابعت كود التحقق'), findsOneWidget);
  });
}
