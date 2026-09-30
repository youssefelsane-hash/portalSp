// **توجيه تلقائي بين الدخول والتسجيل في تطبيق الفني** (docs/08 §189 UX-2، ADR-0115).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:technician_app/core/api_exception.dart';
import 'package:technician_app/core/auth_repository.dart';
import 'package:technician_app/features/auth/login_screen.dart';

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
    String userType = 'technician',
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
  testWidgets('دخول برقم مش مسجّل ⇒ «صنايعي جديد؟» بالرقم، والتركيز على الاسم', (
    tester,
  ) async {
    final auth = _FakeAuth(false);
    await tester.pumpWidget(_wrap(auth));
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01098765432',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.textContaining('صنايعي جديد؟'), findsOneWidget);
    expect(find.byKey(const ValueKey('login-full-name-field')), findsOneWidget);
    expect(find.text('01098765432'), findsOneWidget);
    final nameField = tester.widget<TextField>(
      find.byKey(const ValueKey('login-full-name-field')),
    );
    expect(nameField.focusNode?.hasFocus, isTrue);

    await tester.enterText(
      find.byKey(const ValueKey('login-full-name-field')),
      'فني جديد',
    );
    await _tapKey(tester, 'login-submit');
    expect(find.byKey(const ValueKey('login-pin-confirm-field')), findsOneWidget);
    expect(auth.lookups, 1);
  });

  testWidgets('تسجيل برقم مسجّل (ولو كعميل) ⇒ رمز الدخول مباشرةً', (tester) async {
    final auth = _FakeAuth(true);
    await tester.pumpWidget(_wrap(auth));
    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01512345678',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.textContaining('مسجّل عندنا بالفعل'), findsOneWidget);
    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
    expect(find.byKey(const ValueKey('login-pin-confirm-field')), findsNothing);
  });

  testWidgets('السؤال فشل ⇒ السلوك القديم بالظبط', (tester) async {
    final auth = _FakeAuth(null);
    await tester.pumpWidget(_wrap(auth));
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01098765432',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.byKey(const ValueKey('login-routing-notice')), findsNothing);
    expect(find.byKey(const ValueKey('login-pin-field')), findsOneWidget);
  });

  testWidgets('409 وقت إنشاء الحساب ⇒ توجيه لرمز الدخول', (tester) async {
    final auth = _FakeAuth(null, registerConflict: true);
    await tester.pumpWidget(_wrap(auth));
    await _tapKey(tester, 'login-toggle-mode');
    await tester.enterText(
      find.byKey(const ValueKey('login-full-name-field')),
      'فني',
    );
    await tester.enterText(
      find.byKey(const ValueKey('login-phone-field')),
      '01098765432',
    );
    await _tapKey(tester, 'login-submit');
    await tester.enterText(find.byKey(const ValueKey('login-pin-field')), '482917');
    await tester.enterText(
      find.byKey(const ValueKey('login-pin-confirm-field')),
      '482917',
    );
    await _tapKey(tester, 'login-submit');

    expect(find.textContaining('مسجّل عندنا بالفعل'), findsOneWidget);
    expect(find.byKey(const ValueKey('login-pin-confirm-field')), findsNothing);
  });
}
