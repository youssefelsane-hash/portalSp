// فتح الروابط الخارجية — البَقّة اللي وراه بلاغ المالك 2026-09-11:
// «الفوتر في الأندرويد ما بيفتحش أي حاجة، تدوس على أي حاجة ما بيفتحهاش، ما يعرفش ليه بصراحة».
//
// السبب الجذري مش في الفوتر: `url_launcher` على أندرويد **بيرمي** `PlatformException` لما
// الفتح يفشل، مابيرجّعش `false`. وكل الكود كان مكتوب `if (!await launchUrl(...))` — فرع ميت.
// والاستثناء بيتحصل في `Future` محدش بيستناه، فبيتبلع في اللوج والمستخدم مايشوفش أي حاجة.
//
// الاختبار ده بيقفل الحالتين اللي مستحيل `flutter analyze` يشوفهم:
//   ١. الاستثناء **مابيطلعش** برّه (مش بيكسّر الشاشة ولا بيتبلع بصمت).
//   ٢. المستخدم **بيشوف رسالة** بدل الصمت.
import 'package:customer_app/core/external_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

/// منصة مزيّفة بتحاكي سلوك أندرويد الحقيقي بالحرف — بترمي بدل ما ترجّع false.
class _ThrowingLauncher extends UrlLauncherPlatform with MockPlatformInterfaceMixin {
  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => false;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    throw PlatformException(
      code: 'ACTIVITY_NOT_FOUND',
      message: 'No Activity found to handle intent { $url }',
    );
  }
}

class _OkLauncher extends UrlLauncherPlatform with MockPlatformInterfaceMixin {
  String? launched;

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched = url;
    return true;
  }
}

Future<void> _tap(WidgetTester tester, Future<void> Function(BuildContext) onTap) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => onTap(context),
            child: const Text('افتح'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('افتح'));
  await tester.pumpAndSettle();
}

void main() {
  final original = UrlLauncherPlatform.instance;
  tearDown(() => UrlLauncherPlatform.instance = original);

  testWidgets('فشل الفتح بيوصل للمستخدم كرسالة — مش بيتبلع في اللوج', (tester) async {
    UrlLauncherPlatform.instance = _ThrowingLauncher();

    await _tap(tester, (context) => openExternalUrl(context, Uri.parse('https://ostahome.com/about')));

    expect(tester.takeException(), isNull, reason: 'الاستثناء لازم يتمسك جوّه المساعد');
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.textContaining('مقدرناش نفتح'), findsOneWidget);
  });

  testWidgets('رسالة مخصّصة بتتعرض زي ما هي', (tester) async {
    UrlLauncherPlatform.instance = _ThrowingLauncher();

    await _tap(
      tester,
      (context) => openExternalUrl(context, Uri.parse('https://wa.me/2010'), failureMessage: 'تعذّر فتح واتساب'),
    );

    expect(find.textContaining('تعذّر فتح واتساب'), findsOneWidget);
  });

  testWidgets('النجاح مابيعرضش أي رسالة', (tester) async {
    final launcher = _OkLauncher();
    UrlLauncherPlatform.instance = launcher;

    await _tap(tester, (context) => openExternalUrl(context, Uri.parse('https://ostahome.com/legal/terms')));

    expect(find.byType(SnackBar), findsNothing);
    expect(launcher.launched, 'https://ostahome.com/legal/terms');
  });

  testWidgets('الاتصال بيشيل المسافات وعلامات التنسيق من الرقم', (tester) async {
    final launcher = _OkLauncher();
    UrlLauncherPlatform.instance = launcher;

    await _tap(tester, (context) => openPhoneDialer(context, '+20 (100) 123-4567'));

    // من غير التنضيف الرقم بيوصل `tel:+20%20(100)%20123-4567` وبعض تطبيقات الاتصال
    // بتفتح على رقم ناقص.
    expect(launcher.launched, 'tel:+201001234567');
  });

  testWidgets('البريد بيتفتح كـmailto', (tester) async {
    final launcher = _OkLauncher();
    UrlLauncherPlatform.instance = launcher;

    await _tap(tester, (context) => openEmailApp(context, 'support@ostahome.com'));

    expect(launcher.launched, 'mailto:support@ostahome.com');
  });
}
