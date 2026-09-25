// **اختبار خطوة رمز الدخول** (ADR-0109).
//
// الحاجة اللي الاختبار ده موجود عشانها: إن الخطوة الأولى في شاشة الدخول **مابتعملش أي نداء
// شبكة**. الاختبار ده بيشتغل تحت `TestWidgetsFlutterBinding`، واللي بيرجّع 400 لأي HTTP
// request — فلو الانتقال لخطوة الرمز عمل أي نداء (زي `POST /auth/otp/request` قبل كده)،
// الخطوة مش هتظهر خالص وهنشوف رسالة خطأ مكانها. ظهورها هي **الإثبات** إن مفيش شبكة اتلمست.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/auth/login_screen.dart';

Widget _wrap() => ChangeNotifierProvider<AuthRepository>(
      create: (_) => AuthRepository(),
      child: const MaterialApp(home: LoginScreen()),
    );

/// **لازم `ensureVisible` قبل أي ضغطة هنا.** فورم التسجيل أطول من نافذة الاختبار
/// (٨٠٠×٦٠٠)، فالزرار بيبقى برّه الشاشة جوّه `SingleChildScrollView` والضغطة بتضيع في الهوا
/// **بلا أي رسالة خطأ** — الاختبار بيفشل بـ«الخانة مش موجودة» والسبب الحقيقي حاجة تانية خالص.
Future<void> _tapKey(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('الشاشة بتفتح على خطوة الرقم — خانة الرمز مش موجودة', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    expect(find.byKey(const ValueKey('login-pin-field')), findsNothing);
    expect(find.text('التالي'), findsOneWidget);
  });

  testWidgets('«التالي» بينقل لخطوة الرمز بلا أي نداء شبكة', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+201000000003');
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
    expect(find.text('دخول'), findsOneWidget);
  });

  testWidgets('رقم ناقص بيترفض محليًا ومابيوصلش لخطوة الرمز', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+2010');
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-pin-field')), findsNothing);
    expect(find.text('اكتب رقم موبايل صحيح'), findsOneWidget);
  });

  testWidgets('مود التسجيل بيطلب تأكيد الرمز — خانة زيادة مش موجودة في الدخول', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(find.byKey(const ValueKey('login-full-name-field')), 'عميل اختبار');
    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+201000000003');
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
    expect(find.byKey(const ValueKey('login-pin-confirm-field')), findsOneWidget);
  });

  testWidgets('رمز ضعيف بيترفض محليًا قبل أي نداء', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(find.byKey(const ValueKey('login-full-name-field')), 'عميل اختبار');
    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+201000000003');
    await _tapKey(tester, 'login-submit');

    // `123456` تسلسل صاعد — مرفوض بنفس قاعدة `isWeakPin` في الباك-إند بالحرف.
    await tester.enterText(find.byKey(const ValueKey('login-pin-field')), '123456');
    await tester.enterText(find.byKey(const ValueKey('login-pin-confirm-field')), '123456');
    await _tapKey(tester, 'login-submit');

    expect(
      find.text('الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم'),
      findsOneWidget,
    );
  });

  testWidgets('رمزين مختلفين في التسجيل بيترفضوا — الخانة الزيادة دي سببها الوحيد', (tester) async {
    await tester.pumpWidget(_wrap());
    await tester.pump();

    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(find.byKey(const ValueKey('login-full-name-field')), 'عميل اختبار');
    await tester.enterText(find.byKey(const ValueKey('login-phone-field')), '+201000000003');
    await _tapKey(tester, 'login-submit');

    await tester.enterText(find.byKey(const ValueKey('login-pin-field')), '417253');
    await tester.enterText(find.byKey(const ValueKey('login-pin-confirm-field')), '417254');
    await _tapKey(tester, 'login-submit');

    expect(find.text('الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين'), findsOneWidget);
  });
}
