// docs/08 §185 بنود 21–22 و31 — واتساب الدعم: الرابط صح، «تواصل معنا» فيه خيار واتساب،
// رقم الفوتر بيفتح واتساب مش `tel:`، وفشل الفتح ليه fallback محترم (رسالة فيها الرقم + نسخ).
import 'package:customer_app/core/external_links.dart';
import 'package:customer_app/features/shell/app_footer.dart';
import 'package:customer_app/features/shell/site_info_repository.dart';
import 'package:customer_app/features/support/support_contact_repository.dart';
import 'package:customer_app/features/support/support_contact_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher/url_launcher.dart';

SupportContact _contact({bool enabled = false, String? whatsappUrl, String? phone}) => SupportContact(
  enabled: enabled,
  phoneNumber: phone,
  whatsappUrl: whatsappUrl,
  email: null,
  helpUrl: null,
);

const _entity = LegalEntityInfo(
  platformNameAr: 'أسطى',
  platformNameEn: 'OSTA',
  companyNameAr: 'الصانع جروب',
  companyNameEn: 'ELSANE Group',
  supportPhone: '+201505988990',
);

void main() {
  group('whatsappChatUri', () {
    test('رقم الدعم زي ما في الفوتر ⇒ wa.me/201505988990', () {
      expect(whatsappChatUri('+201505988990').toString(), 'https://wa.me/201505988990');
      expect(whatsappChatUri('+20 150 598 8990').toString(), 'https://wa.me/201505988990');
      expect(whatsappChatUri('01505988990').toString(), 'https://wa.me/201505988990');
      expect(whatsappChatUri('٠١٥٠٥٩٨٨٩٩٠').toString(), 'https://wa.me/201505988990');
    });

    test('رقم مايصلحش ⇒ null', () {
      expect(whatsappChatUri(null), isNull);
      expect(whatsappChatUri('123'), isNull);
      expect(whatsappChatUri('javascript:alert(1)'), isNull);
    });
  });

  test('رقم الفوتر بيروح لواتساب مش tel:', () {
    final target = footerSupportUri('+201505988990');
    expect(target.scheme, 'https');
    expect(target.host, 'wa.me');
    expect(target.toString(), 'https://wa.me/201505988990');
    // احتياطي بس: رقم قصير مايصلحش لواتساب.
    expect(footerSupportUri('19999').scheme, 'tel');
  });

  group('resolveSupportWhatsappUri — الرقم من الإعدادات مش من الكود', () {
    test('رقم واتساب خدمة العملاء المفعّل بياخد الأولوية', () {
      final uri = resolveSupportWhatsappUri(
        contact: _contact(enabled: true, whatsappUrl: 'https://wa.me/201000000001'),
        entity: _entity,
      );
      expect(uri.toString(), 'https://wa.me/201000000001');
    });

    test('خدمة العملاء مش مفعّلة ⇒ رقم الدعم في بيانات الجهة (نفس الفوتر)', () {
      final uri = resolveSupportWhatsappUri(
        contact: _contact(whatsappUrl: 'https://wa.me/201000000001'),
        entity: _entity,
      );
      expect(uri.toString(), 'https://wa.me/201505988990');
    });

    test('رابط مش wa.me (إعداد غلط) مابيتفتحش', () {
      final uri = resolveSupportWhatsappUri(
        contact: _contact(enabled: true, whatsappUrl: 'http://evil.example/wa'),
        entity: null,
      );
      expect(uri, isNull);
    });
  });

  testWidgets('«تواصل معنا»: التذاكر والشات موجودين + خيار واتساب التالت', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SupportContactScreen(
          loadContact: () async => _contact(),
          loadEntity: () async => _entity,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('تذاكر الدعم'), findsOneWidget);
    expect(find.text('شات الدعم'), findsOneWidget);
    expect(find.text('تواصل معنا على واتساب'), findsOneWidget);
    expect(find.text('ابعتلنا رسالتك على واتساب'), findsOneWidget);
    // خدمة العملاء مش مفعّلة ⇒ مفيش زرار اتصال بيودّي لرقم مش مضبوط.
    expect(find.text('اتصل بينا'), findsNothing);
  });

  testWidgets('«تواصل معنا» من غير شبكة: التذاكر والشات بيفضلوا، وواتساب بيختفي بدل ما يبقى فاضي', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SupportContactScreen(
          loadContact: () => Future.error(Exception('offline')),
          loadEntity: () => Future.error(Exception('offline')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('تذاكر الدعم'), findsOneWidget);
    expect(find.text('شات الدعم'), findsOneWidget);
    expect(find.text('تواصل معنا على واتساب'), findsNothing);
  });

  group('openWhatsappChat — fallback', () {
    Future<(bool, List<LaunchMode>)> run(
      WidgetTester tester,
      Future<bool> Function(Uri, LaunchMode) behave,
    ) async {
      final modes = <LaunchMode>[];
      late Future<bool> result;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => result = openWhatsappChat(
                  context,
                  Uri.parse('https://wa.me/201505988990'),
                  launcher: (uri, mode) {
                    modes.add(mode);
                    return behave(uri, mode);
                  },
                ),
                child: const Text('واتساب'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('واتساب'));
      await tester.pump();
      return (await result, modes);
    }

    testWidgets('واتساب/المتصفح موجود ⇒ بيفتح من أول محاولة', (tester) async {
      final (opened, modes) = await run(tester, (_, _) async => true);
      expect(opened, isTrue);
      expect(modes, [LaunchMode.externalApplication]);
    });

    testWidgets('التطبيق الخارجي رمى ACTIVITY_NOT_FOUND ⇒ متصفح جوّه التطبيق', (tester) async {
      final (opened, modes) = await run(tester, (_, mode) async {
        if (mode == LaunchMode.externalApplication) {
          throw PlatformException(code: 'ACTIVITY_NOT_FOUND');
        }
        return true;
      });
      expect(opened, isTrue);
      expect(modes, [LaunchMode.externalApplication, LaunchMode.inAppBrowserView]);
    });

    testWidgets('مفيش أي طريقة تفتح ⇒ رسالة فيها الرقم وزرار نسخ', (tester) async {
      final (opened, _) = await run(tester, (_, _) async => false);
      expect(opened, isFalse);
      await tester.pump();
      expect(find.textContaining('201505988990'), findsOneWidget);
      expect(find.text('انسخ الرقم'), findsOneWidget);
    });
  });
}
