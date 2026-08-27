import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:customer_app/core/auth_gate.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/shell/customer_shell.dart';

// docs/08 §77-B1 — «مش لازم يعمل لوج إن أول ما يخش… بس أول ما يدوس على خدمة محددة يطلع له
// واجهة وسيطة تقول له سجل نفسك».
//
// `AuthRepository` بيقرا التخزين الآمن في `init()`، فالاختبارات دي **مش** بتناديه — بتبني
// المستودع وتسيبه في حالته الافتراضية (مش مسجّل)، وده بالظبط حالة الزائر اللي بنختبرها.
class _GuestAuth extends AuthRepository {
  @override
  bool get isAuthenticated => false;
  @override
  bool get isLoading => false;
}

class _SignedInAuth extends AuthRepository {
  @override
  bool get isAuthenticated => true;
  @override
  bool get isLoading => false;
}

void main() {
  Widget wrap(AuthRepository auth, Widget child) => ChangeNotifierProvider<AuthRepository>.value(
        value: auth,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Directionality(textDirection: TextDirection.rtl, child: child),
        ),
      );

  group('ensureSignedIn — بوابة الزائر', () {
    testWidgets('مستخدم مسجّل: بتعدّي فورًا بلا أي واجهة وسيطة', (tester) async {
      bool? result;
      await tester.pumpWidget(wrap(
        _SignedInAuth(),
        Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ensureSignedIn(context, reason: 'سبب');
            },
            child: const Text('احجز'),
          ),
        ),
      ));
      await tester.tap(find.text('احجز'));
      await tester.pumpAndSettle();
      expect(result, isTrue);
      // ولا حتى ومضة من الـsheet.
      expect(find.text('خطوة واحدة وتكمّل'), findsNothing);
    });

    testWidgets('زائر: بتعرض الدعوة بالسبب اللي المستدعي حدده', (tester) async {
      await tester.pumpWidget(wrap(
        _GuestAuth(),
        Builder(
          builder: (context) => TextButton(
            onPressed: () => ensureSignedIn(context, reason: 'عشان نحجزلك «سباكة»'),
            child: const Text('احجز'),
          ),
        ),
      ));
      await tester.tap(find.text('احجز'));
      await tester.pumpAndSettle();
      expect(find.text('خطوة واحدة وتكمّل'), findsOneWidget);
      // السبب بيتعرض حرفيًا — رسالة عامة أضعف من رسالة بتقول له كان بيعمل إيه.
      expect(find.text('عشان نحجزلك «سباكة»'), findsOneWidget);
    });

    testWidgets('«لسه بتتفرّج»: بترجّع false والعميل بيفضل مكانه', (tester) async {
      bool? result;
      await tester.pumpWidget(wrap(
        _GuestAuth(),
        Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ensureSignedIn(context, reason: 'سبب');
            },
            child: const Text('احجز'),
          ),
        ),
      ));
      await tester.tap(find.text('احجز'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('لسه بتتفرّج؟ كمّل تصفّح'));
      await tester.pumpAndSettle();
      expect(result, isFalse);
      // مفيش شاشة دخول اتفتحت — الرفض معناه رجوع للتصفّح، مش توجيه إجباري.
      expect(find.text('كود التحقق'), findsNothing);
    });
  });

  group('CustomerShell — التبويبات للزائر', () {
    // القاعدة اللي بتمنع الرجوع للسلوك القديم: الرئيسية بس هي المفتوحة، والباقي بيانات شخصية.
    test('الرئيسية بس هي اللي مش محتاجة حساب', () {
      expect(CustomerTab.home.requiresAccount, isFalse);
      expect(
        CustomerTab.values.where((t) => !t.requiresAccount).toList(),
        [CustomerTab.home],
      );
    });

    testWidgets('زائر فتح «طلباتي»: دعوة مفهومة مش شاشة بتفشل', (tester) async {
      await tester.pumpWidget(wrap(
        _GuestAuth(),
        const CustomerShell(initialTab: CustomerTab.orders),
      ));
      await tester.pumpAndSettle();
      expect(find.text('طلباتك هتظهر هنا'), findsOneWidget);
      expect(find.text('اعمل حساب أو سجّل دخول'), findsOneWidget);
    });

    testWidgets('زائر فتح «ضماناتي»: رسالة مخصّصة للتبويب ده مش نص عام', (tester) async {
      await tester.pumpWidget(wrap(
        _GuestAuth(),
        const CustomerShell(initialTab: CustomerTab.warranties),
      ));
      await tester.pumpAndSettle();
      expect(find.text('ضمانات شغلك هتظهر هنا'), findsOneWidget);
    });
  });
}
