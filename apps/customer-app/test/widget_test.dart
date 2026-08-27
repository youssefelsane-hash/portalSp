// اختبار دخان: التطبيق من غير جلسة محفوظة لازم يفتح على **الرئيسية** — مش على شاشة دخول.
//
// **الاختبار ده كان بيختبر العكس بالظبط** («يعرض شاشة تسجيل الدخول لما مفيش جلسة محفوظة»)،
// واتغيّر بطلب مالك صريح (docs/08 §77-B1): «المفروض أول ما الكاستمر يفتح الأبليكيشن يفتح معاه
// عادي جدًا… مش لازم يعمل لوج إن أول ما يخش». التسجيل بقى **مشروط بأول خطوة حجز** مش بفتح
// التطبيق — البوابة في `core/auth_gate.dart` واختباراتها في `guest_browsing_test.dart`.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:customer_app/features/shell/customer_shell.dart';
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

  testWidgets('زائر بلا جلسة: التطبيق بيفتح على القشرة مباشرة', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakApp());
    await tester.pump();

    // القشرة (بشريطها السفلي) هي نقطة الدخول للاتنين — مسجّل وزائر.
    expect(find.byType(CustomerShell), findsOneWidget);
    // ولا أثر لشاشة الدخول: مفيش أي إجبار على التسجيل قبل التصفّح.
    expect(find.text('ابعت كود التحقق'), findsNothing);
  });

  testWidgets('التبويبات الأربعة موجودة للزائر برضه', (WidgetTester tester) async {
    await tester.pumpWidget(const BaytakApp());
    await tester.pump();

    for (final tab in CustomerTab.values) {
      expect(find.text(tab.label), findsWidgets, reason: 'تبويب ${tab.label} ناقص');
    }
  });
}
