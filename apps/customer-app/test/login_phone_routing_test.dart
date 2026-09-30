// **توجيه تلقائي بين الدخول والتسجيل** (docs/08 §189 UX-2، ADR-0115).
//
// المستخدم غير التقني بيكتب رقمه في أي مود يلاقيه. الشاشة بتسأل مرة واحدة عند «التالي» وبتنقله
// للمود الصح بالرقم مكتوب ورسالة بتقوله ليه.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:customer_app/core/api_exception.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/auth/login_screen.dart';

class _FakeAuth extends AuthRepository {
  _FakeAuth(this.registered, {this.registerConflict = false});
  final bool? registered;
  final bool registerConflict;
  int lookups = 0;

  @override
  Future<bool?> isPhoneRegistered(String phoneNumber) async {
    lookups++;
    return registered;
  }

  @override
  Future<void> registerWithPin(
    String phoneNumber,
    String pin,
    String fullName, {
    String? referralCode,
    String? technicianReferralCode,
  }) async {
    if (registerConflict) {
      throw ApiException(
        code: 'VAL_001',
        message: 'الرقم ده مسجل قبل كده، سجّل دخول بدل كده',
        statusCode: 409,
      );
    }
  }
}

Widget _wrap(_FakeAuth auth) => ChangeNotifierProvider<AuthRepository>.value(
  value: auth,
  child: const MaterialApp(home: LoginScreen()),
);

Future<void> _tapKey(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'دخول برقم مش مسجّل ⇒ مود «حساب جديد» بالرقم ورسالة، والتركيز على الاسم',
    (tester) async {
      final auth = _FakeAuth(false);
      await tester.pumpWidget(_wrap(auth));
      await tester.enterText(
        find.byKey(const ValueKey('login-phone-field')),
        '01098765432',
      );
      await _tapKey(tester, 'login-submit');

      expect(auth.lookups, 1);
      expect(
        find.byKey(const ValueKey('login-routing-notice')),
        findsOneWidget,
      );
      expect(find.textContaining('الرقم ده جديد عندنا'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('login-full-name-field')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('login-pin-field')), findsNothing);
      // الرقم مكتوب زي ما هو — مايتكتبش تاني.
      expect(find.text('01098765432'), findsOneWidget);
      final nameField = tester.widget<TextField>(
        find.byKey(const ValueKey('login-full-name-field')),
      );
      expect(nameField.focusNode?.hasFocus, isTrue);

      // «التالي» تاني بعد كتابة الاسم ⇒ خطوة الرمز، من غير سؤال تاني لنفس الرقم.
      await tester.enterText(
        find.byKey(const ValueKey('login-full-name-field')),
        'عميل جديد',
      );
      await _tapKey(tester, 'login-submit');
      expect(
        find.byKey(const ValueKey('login-pin-confirm-field')),
        findsOneWidget,
      );
      expect(auth.lookups, 1);
    },
  );

  testWidgets(
    'تسجيل برقم مسجّل ⇒ خطوة رمز الدخول مباشرةً، من غير ما يتسأل عن اسمه',
    (tester) async {
      final auth = _FakeAuth(true);
      await tester.pumpWidget(_wrap(auth));
      await _tapKey(tester, 'login-toggle-mode');
      await tester.enterText(
        find.byKey(const ValueKey('login-phone-field')),
        '01512345678',
      );
      await _tapKey(tester, 'login-submit');

      expect(find.textContaining('إنت عندك حساب بالفعل'), findsOneWidget);
      expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('login-pin-confirm-field')),
        findsNothing,
      );
      expect(find.text('دخول'), findsOneWidget);
    },
  );

  testWidgets('الرقم في المود الصح ⇒ مفيش رسالة ولا تغيير', (tester) async {
    final auth = _FakeAuth(true);
    await tester.pumpWidget(_wrap(auth));
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01012345678',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-routing-notice')), findsNothing);
    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
  });

  testWidgets('السؤال فشل (null) ⇒ السلوك القديم بالظبط', (tester) async {
    final auth = _FakeAuth(null);
    await tester.pumpWidget(_wrap(auth));
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01012345678',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-routing-notice')), findsNothing);
    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
  });

  testWidgets('409 وقت إنشاء الحساب ⇒ نفس التوجيه لتسجيل الدخول (احتياطي)', (
    tester,
  ) async {
    final auth = _FakeAuth(null, registerConflict: true);
    await tester.pumpWidget(_wrap(auth));
    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(
      find.byKey(const ValueKey('login-full-name-field')),
      'عميل',
    );
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01012345678',
    );
    await _tapKey(tester, 'login-submit');
    await tester.enterText(
      find.byKey(const ValueKey('login-pin-field')),
      '482917',
    );
    await tester.enterText(
      find.byKey(const ValueKey('login-pin-confirm-field')),
      '482917',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.textContaining('إنت عندك حساب بالفعل'), findsOneWidget);
    expect(find.byKey(const ValueKey('login-pin-confirm-field')), findsNothing);
    expect(find.text('دخول'), findsOneWidget);
  });
}
