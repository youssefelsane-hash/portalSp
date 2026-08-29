// انحدار مثبّت (بلاغ مالك 2026-08-25): "شاشة حمرا ظهرت في التطبيقين بعد اللوجن على طول".
// الشاشة الحمرا = `ErrorWidget` بتاع Flutter (`RenderErrorBox` بيرسم أحمر داكن) — يعني استثناء
// وقت البناء. السبب كان `tooltip:` على الزرار العايم: `Tooltip` بيحتاج `Overlay` جدّ، والزرار
// متركّب في `MaterialApp.builder` جنب `child` يعني **بره الـNavigator** فمفيش Overlay فوقه.
//
// الاختبار ده بيعيد نفس التركيب بالحرف (Stack جوّه builder، بلا Overlay) ويتأكد إن البناء
// مابيرميش. أي ويدجت تتضاف هناك بعد كده وبتحتاج Overlay هتوقّع الاختبار ده فورًا.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/features/notifications/floating_notification_alert.dart';
import 'package:customer_app/features/shell/customer_shell.dart';
import 'package:customer_app/features/warranty/warranties_screen.dart';

class _SignedInAuth extends AuthRepository {
  @override
  bool get isAuthenticated => true;

  @override
  bool get isLoading => false;

  @override
  Future<List<Map<String, dynamic>>> authedRequestList(String path) async => [];

  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) async {
    if (path == '/notifications/unread-count') return {'unread_count': 3};
    return <String, dynamic>{};
  }
}

void main() {
  testWidgets(
    'الزرار العايم بيتبني بلا استثناء وهو بره الـNavigator (مفيش Overlay)',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('ar', 'EG'),
          builder: (context, child) => Stack(
            children: [
              child ?? const SizedBox.shrink(),
              // نفس تركيب main.dart بالحرف.
              PositionedDirectional(
                end: 16,
                bottom: 88,
                child: Semantics(
                  label: '3 إشعارات غير مقروءة',
                  button: true,
                  child: const FloatingActionButton.small(
                    heroTag: 'global-unread-notifications',
                    onPressed: null,
                    child: Badge(
                      label: Text('3'),
                      child: Icon(Icons.mark_unread_chat_alt_outlined),
                    ),
                  ),
                ),
              ),
            ],
          ),
          home: const Scaffold(body: Text('شاشة بعد اللوجن')),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      // ErrorWidget ما اترسمش — يعني مفيش شاشة حمرا.
      expect(find.byType(ErrorWidget), findsNothing);
      expect(find.byType(FloatingActionButton), findsOneWidget);
    },
  );

  testWidgets(
    'حارس: Tooltip في نفس المكان بيرمي — ده اللي كان بيعمل الشاشة الحمرا',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('ar', 'EG'),
          builder: (context, child) => Stack(
            children: [
              child ?? const SizedBox.shrink(),
              const PositionedDirectional(
                end: 16,
                bottom: 88,
                child: FloatingActionButton.small(
                  heroTag: 'with-tooltip',
                  onPressed: null,
                  tooltip: 'رسائل وإشعارات جديدة',
                  child: Icon(Icons.mark_unread_chat_alt_outlined),
                ),
              ),
            ],
          ),
          home: const Scaffold(body: Text('شاشة بعد اللوجن')),
        ),
      );
      await tester.pump();

      // بيوثّق السبب الجذري صراحة: أي حاجة محتاجة Overlay في المكان ده بترمي.
      expect(tester.takeException().toString(), contains('Overlay'));
    },
  );

  testWidgets('الغلاف Host لا ينشئ Overlay أو Hero مستقلين خارج الـNavigator', (
    tester,
  ) async {
    // AuthRepository محتاجة عشان الويدجت الحقيقية تتبني (بتقراها في initState) — مفيش init()
    // فمفيش أي نداء على secure storage أو الشبكة من الكونستركتور.
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthRepository>(
        create: (_) => AuthRepository(),
        child: MaterialApp(
          locale: const Locale('ar', 'EG'),
          builder: (context, child) => Stack(
            children: [
              child ?? const SizedBox.shrink(),
              // نفس تركيب main.dart بالحرف.
              const PositionedDirectional(
                end: 16,
                bottom: 88,
                child: FloatingNotificationAlertHost(),
              ),
            ],
          ),
          home: const Scaffold(body: Text('شاشة بعد اللوجن')),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);

    // الزر خارج Navigator عمدًا، ولذلك لا يجوز إنشاء شجرة انتقال ثانية تحته.
    final hostContext = tester.element(
      find.byType(FloatingNotificationAlertHost),
    );
    expect(
      Overlay.maybeOf(hostContext),
      isNull,
      reason: 'الغلاف نفسه لسه بره أي Overlay',
    );
    final innerContext = tester.element(find.byType(FloatingNotificationAlert));
    expect(
      Overlay.maybeOf(innerContext),
      isNull,
      reason: 'الزر لا يحتاج Overlay محليًا',
    );
    final button = tester.widget<FloatingActionButton>(
      find.byType(FloatingActionButton),
    );
    expect(
      button.heroTag,
      isNull,
      reason: 'Hero خارج Navigator يعلّق اعتمادات الانتقال',
    );
  });

  testWidgets('فتح ضماناتي مع زر الإشعارات العالمي لا يكسر شجرة Flutter', (
    tester,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthRepository>.value(
        value: _SignedInAuth(),
        child: MaterialApp(
          builder: (context, child) => Stack(
            children: [
              child ?? const SizedBox.shrink(),
              const PositionedDirectional(
                end: 16,
                bottom: 88,
                child: FloatingNotificationAlertHost(),
              ),
            ],
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const WarrantiesScreen()),
                  ),
                  child: const Text('افتح ضماناتي'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('افتح ضماناتي'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
    expect(find.byType(WarrantiesScreen), findsOneWidget);
    expect(find.text('لا توجد ضمانات مرتبطة بطلباتك حتى الآن'), findsOneWidget);
  });

  testWidgets('تبويب ضماناتي يفتح من الشريط السفلي مع بقاء الإشعارات', (
    tester,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthRepository>.value(
        value: _SignedInAuth(),
        child: MaterialApp(
          builder: (context, child) => Stack(
            children: [
              child ?? const SizedBox.shrink(),
              const PositionedDirectional(
                end: 16,
                bottom: 88,
                child: FloatingNotificationAlertHost(),
              ),
            ],
          ),
          home: const CustomerShell(initialTab: CustomerTab.orders),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('ضماناتي'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorWidget), findsNothing);
    expect(find.byType(WarrantiesScreen), findsOneWidget);
    expect(find.text('لا توجد ضمانات مرتبطة بطلباتك حتى الآن'), findsOneWidget);
  });
}
