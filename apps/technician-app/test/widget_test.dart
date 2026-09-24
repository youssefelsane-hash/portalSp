// اختبار دخان بسيط: التطبيق (من غير جلسة محفوظة) لازم يعرض شاشة تسجيل الدخول.
import 'package:flutter/foundation.dart';
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

    expect(find.text('أسطى'), findsWidgets);
    // **بالمفتاح مش بالنص** (ADR-0109): النسخة القديمة كانت بتدوّر على `'ابعت كود التحقق'`،
    // فأي تغيير في كلام الزرار بيسقّط الاختبار من غير أي عيب حقيقي — وده اللي حصل بالظبط لما
    // الزرار بقى «التالي» (مفيش كود بيتبعت خلاص). المفتاح بيختبر **وجود** الزرار، والنص
    // منفصل عنه.
    expect(find.byKey(const ValueKey('login-submit')), findsOneWidget);
    expect(find.byKey(const ValueKey('login-phone-field')), findsOneWidget);

    // خطوة الرمز مالهاش وجود قبل ما المستخدم يدوس «التالي» — ده اللي بيثبت إن الشاشة بقت
    // خطوتين حقيقيين مش خانة واحدة مخفية.
    expect(find.byKey(const ValueKey('login-pin-field')), findsNothing);
  });

  testWidgets('«التالي» بينقل لخطوة الرمز بلا أي نداء شبكة', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakTechnicianApp());
    await tester.pumpAndSettle();

    // **ده جوهر ADR-0109**: الاختبار ده بيشتغل تحت `TestWidgetsFlutterBinding`، واللي بيرجّع
    // 400 لأي HTTP request. فلو الانتقال لخطوة الرمز كان لسه بيعمل أي نداء (زي `otp/request`
    // قبل كده)، الخطوة مكانتش هتظهر خالص وكنا هنشوف رسالة خطأ. ظهورها = إثبات إن مفيش شبكة.
    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+201000000021');
    await tester.tap(find.byKey(const ValueKey('login-submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
    expect(find.byKey(const ValueKey('login-error-text')), findsNothing);
  });

  testWidgets('رقم ناقص بيترفض محليًا ومابيوصلش لخطوة الرمز', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakTechnicianApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+2010');
    await tester.tap(find.byKey(const ValueKey('login-submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('login-pin-field')), findsNothing);
    expect(find.byKey(const ValueKey('login-error-text')), findsOneWidget);
  });
}
