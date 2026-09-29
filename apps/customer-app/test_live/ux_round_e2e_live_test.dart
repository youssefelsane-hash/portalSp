// **تحقق End-to-End حقيقي لجولة UX** (docs/08 §185) — الـAPI وPostgres حقيقيين، وكود التطبيق
// نفسه (الـrepositories والشاشات)، مش نسخة من المنطق جوّه الاختبار.
//
// المسار:
//   ١. الأدمن (API الأدمن الحقيقي) بيعمل خدمة وحقولها — ومنها default_value — وبيغيّر نافذة الحجز
//      ورقم الدعم من الإعدادات (step-up حقيقي).
//   ٢. التطبيق بيحمّل النافذة والحقول بالـrepositories بتاعته ويعرضهم في `JobDetailsScreen`
//      الحقيقية: «متابعة» من غير الإجباري ⇒ الرسالة تحت الحقل؛ بعد الملء ⇒ الشاشة بترجّع القيم.
//   ٣. العنوان بيتعمل من `AddressesRepository` بالعمارة/الدور/الشقة/العلامة/ملاحظات الوصول.
//   ٤. الطلب بيتعمل من `OrdersRepository.create` بنفس القيم. Postgres: العدّاد int، الـmetadata،
//      `duration_minutes = 1` ومدته في الجدولة زي ما هي.
//   ٥. وقت برّه النافذة الجديدة بيترفض من السيرفر.
//   ٦. «تواصل معنا» بـloaders الحقيقية بيعرض واتساب على رقم الإعدادات.
//
// بيكتب رقم الطلب في ملف تسليم لـ`apps/technician-app/test_live/ux_round_e2e_live_test.dart`
// (التكملة عند مقدم الخدمة). التشغيل بالترتيب: `scripts/verify-ux-round-e2e.sh`.
import 'dart:convert';
import 'dart:io';

import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/core/work_scope_label.dart';
import 'package:customer_app/features/addresses/addresses_repository.dart';
import 'package:customer_app/features/catalog/catalog_repository.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/pricing_field_widgets.dart';
import 'package:customer_app/features/orders/booking_time_picker.dart';
import 'package:customer_app/features/orders/booking_window.dart';
import 'package:customer_app/features/orders/job_details_screen.dart';
import 'package:customer_app/features/orders/orders_repository.dart';
import 'package:customer_app/features/shell/app_footer.dart';
import 'package:customer_app/features/support/support_contact_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import '_live_support.dart';

const _adminPhone = '+201000000098';
const _supportPhone = '+201505988990';
final handoffFile = File('${Directory.systemTemp.path}/osta-ux-round-e2e.json');

/// `scripts/verify-ux-round-e2e.sh` بيسيب الطلب لتكملة الفني وبيمسحه هو بعدها؛ أي تشغيل تاني
/// (زي `flutter test test_live/`) لازم يمسح وراه عشان مايسيبش خدمة تبوّظ اختبارات تانية.
const _handoffMode = bool.fromEnvironment('UX_E2E_HANDOFF');

class _LiveAuth extends AuthRepository {
  _LiveAuth(this._token, this._user);
  final String _token;
  final BaytakUser _user;
  @override
  String? get accessToken => _token;
  @override
  BaytakUser? get user => _user;
  @override
  bool get isAuthenticated => true;
  @override
  bool get isLoading => false;
  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) => apiRequest(method, path, body: body, accessToken: _token, extraHeaders: extraHeaders);
  @override
  Future<List<Map<String, dynamic>>> authedRequestList(String path) => apiRequestList(path, accessToken: _token);
}

String _psql(String sql) {
  final result = Process.runSync(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', 'baytak_main', '-Atc', sql],
    environment: {'PGPASSWORD': 'baytak'},
  );
  if (result.exitCode != 0) throw StateError('psql: ${result.stderr}');
  return (result.stdout as String).trim().split('\n').first.trim();
}

Future<void> _setSetting(String key, Object value) async => apiRequest(
  'PATCH',
  '/admin/settings/$key',
  accessToken: await devAdminToken(_adminPhone),
  extraHeaders: await stepUpHeader(_adminPhone),
  body: {'value': value},
);

late AuthRepository auth;
late String adminToken;
late String serviceId;
late String customerPhone;
final Map<String, Object?> previousSettings = {};

/// I/O حقيقي جوّه `testWidgets` لازم يعدّي من `runAsync` (الزمن الوهمي مابيخلّصش HTTP).
Future<T> _real<T>(WidgetTester tester, Future<T> Function() body) async => (await tester.runAsync(body)) as T;

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 150)));
    await tester.pump(const Duration(milliseconds: 150));
  }
}

void main() {
  setUpAll(() async {
    HttpOverrides.global = null;
    TestWidgetsFlutterBinding.ensureInitialized();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (call) async => switch (call.method) {
        'readAll' => <String, String>{},
        'containsKey' => false,
        _ => null,
      },
    );

    adminToken = await devAdminToken(_adminPhone);
    for (final key in ['booking.selectable_start_hour', 'booking.selectable_end_hour', 'legal.support_phone']) {
      previousSettings[key] = jsonDecode(_psql("SELECT value::text FROM settings WHERE key='$key'"));
    }

    // ── ١. الأدمن: خدمة + حقول (منها default_value) + معادلة بمدة جدولة دقيقة ──
    final categories = await apiRequestList('/service-categories');
    final service = await apiRequest(
      'POST',
      '/admin/services',
      accessToken: adminToken,
      body: {
        'category_id': categories.first['id'],
        'name_ar': 'مكوجي (E2E جولة UX)',
        'slug': 'laundry-ux-e2e-${DateTime.now().millisecondsSinceEpoch}',
        'pricing_model': 'formula',
        'base_price_cents': 0,
        'allows_individual': true,
      },
    );
    serviceId = service!['id'] as String;
    Future<void> field(Map<String, dynamic> body) =>
        apiRequest('POST', '/admin/services/$serviceId/pricing-fields', accessToken: adminToken, body: body);
    const types = [
      {'value': 'iron_only', 'label_ar': 'كي فقط'},
      {'value': 'wash_iron', 'label_ar': 'غسيل + كي'},
      {'value': 'dry_clean_iron', 'label_ar': 'دراي كلين + كي'},
    ];
    await field({
      'field_key': 'main_type',
      'label_ar': 'نوع الخدمة الأساسي',
      'field_type': 'dropdown',
      'is_required': true,
      'display_order': 1,
      'options': types,
      'unit_ar': '(الاختيار ده هيتطبق تلقائيًا على كل الملابس في الطلب.)',
    });
    await field({
      'field_key': 'shirts',
      'label_ar': 'عدد القمصان',
      'field_type': 'slider',
      'is_required': false,
      'display_order': 2,
      'min_value': 0,
      'max_value': 15,
      'unit_ar': 'قميص',
    });
    await field({
      'field_key': 'shirts_type',
      'label_ar': 'نوع الخدمة للقمصان',
      'field_type': 'dropdown',
      'is_required': false,
      'display_order': 3,
      'default_value': 'same_as_main',
      'options': [
        {'value': 'same_as_main', 'label_ar': 'نفس الخدمة الأساسية'},
        ...types,
      ],
    });
    await field({
      'field_key': 'dresses',
      'label_ar': 'عدد الفساتين (Dresses / Gowns)',
      'field_type': 'slider',
      'is_required': false,
      'display_order': 4,
      'min_value': 0,
      'max_value': 15,
      'unit_ar': '(حدد عدد الفساتين في الطلب.)',
    });
    await apiRequest(
      'PUT',
      '/admin/services/$serviceId/pricing-rules',
      accessToken: adminToken,
      body: {
        'rule_type': 'formula',
        'rule_key': 'final_price',
        'payload': {
          'price_cents': {'type': 'literal', 'value': 25000},
          // المغسلة: دقيقة واحدة عمدًا للجدولة (الفرع يستقبل طلبات كتير في نفس الفترة).
          'duration_minutes': {'type': 'literal', 'value': 1},
        },
      },
    );

    // نافذة حجز جديدة ورقم دعم من إعدادات الأدمن الحقيقية.
    await _setSetting('booking.selectable_start_hour', 8);
    await _setSetting('booking.selectable_end_hour', 16);
    await _setSetting('legal.support_phone', _supportPhone);

    customerPhone = uniquePhone();
    final token = await registerCustomer(customerPhone, fullName: 'عميل E2E جولة UX');
    final me = await apiRequest('GET', '/auth/me', accessToken: token);
    auth = _LiveAuth(token, BaytakUser.fromJson(me!));
  });

  tearDownAll(() async {
    for (final entry in previousSettings.entries) {
      if (entry.value != null) await _setSetting(entry.key, entry.value!);
    }
    if (!_handoffMode) {
      final cleaned = Process.runSync('node', ['../../scripts/clean-test-data.js', '--service', serviceId]);
      if (cleaned.exitCode != 0) throw StateError('clean-test-data: ${cleaned.stderr}');
      _psql(
        "DELETE FROM service_pricing_rules WHERE service_id='$serviceId'; "
        "DELETE FROM service_pricing_fields WHERE service_id='$serviceId'; "
        "UPDATE services SET deleted_at = now() WHERE id='$serviceId'",
      );
    }
  });

  testWidgets('E2E: أدمن ⇒ تطبيق العميل ⇒ طلب ⇒ Postgres', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    // ── نافذة الحجز من السيرفر (BookingWindow.fetch الحقيقية) ──
    BookingWindow.resetCacheForTests();
    final window = await _real(tester, BookingWindow.fetch);
    expect((window.startHour, window.endHour), (8, 16), reason: 'التطبيق لازم يقرا نافذة الأدمن الجديدة من غير build');
    final options = BookingTimeOptions(window);
    expect(options.hours.first, 8);
    expect(options.hours.last, 16);
    expect(options.isSelectable(const TimeOfDay(hour: 7, minute: 59)), isFalse);
    expect(options.isSelectable(const TimeOfDay(hour: 16, minute: 1)), isFalse);
    expect(options.isSelectable(const TimeOfDay(hour: 16, minute: 0)), isTrue);

    // ── العنوان من AddressesRepository الحقيقي بكل تفاصيل الوصول ──
    final cities = await _real(tester, () => apiRequestList('/cities'));
    final areas = await _real(tester, () => apiRequestList('/cities/${cities.first['id']}/areas'));
    final address = await _real(
      tester,
      () => AddressesRepository(auth).create(
        cityId: cities.first['id'] as String,
        areaId: areas.first['id'] as String,
        streetName: 'شارع التعاونيات',
        latitude: 30.0444,
        longitude: 31.2357,
        label: 'البيت',
        buildingNumber: '15',
        floorNumber: '3',
        apartmentNumber: '7',
        landmark: 'جنب شركة الكهرباء',
        deliveryNotes: 'الجرس مش شغال، كلمني قبل ما تطلع',
      ),
    );
    expect(
      address.deliveryNotes,
      'الجرس مش شغال، كلمني قبل ما تطلع',
      reason: 'ملاحظات الوصول لازم ترجع في موديل العنوان',
    );

    // ── الحقول من CatalogRepository + الشاشة الحقيقية ──
    final catalog = await _real(tester, () => CatalogRepository().fetchService(serviceId));
    final fields = await _real(tester, () => CatalogRepository().fetchPricingFields(serviceId));
    expect(
      fields.firstWhere((f) => f.fieldKey == 'shirts_type').defaultValue,
      'same_as_main',
      reason: 'default_value اللي الأدمن حطّه لازم يوصل لموديل التطبيق',
    );

    JobDetailsResult? result;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthRepository>.value(
        value: auth,
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async {
                    result = await Navigator.of(context).push<JobDetailsResult>(
                      MaterialPageRoute(
                        builder: (_) => JobDetailsScreen(service: catalog, initialAddress: address),
                      ),
                    );
                  },
                  child: const Text('ابدأ'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('ابدأ'));
    await _settle(tester);

    // الشكل الجديد: ٣ اختيارات ظاهرة (مش dropdown)، الشرح كامل، العدّاد stepper.
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    // موجودة في سؤالين (النوع الأساسي + «نوع الخدمة للقمصان») — الاتنين ظاهرين كاختيارات.
    expect(find.text('غسيل + كي'), findsNWidgets(2));
    expect(find.text('الاختيار ده هيتطبق تلقائيًا على كل الملابس في الطلب.'), findsOneWidget);
    expect(find.text('0 قميص'), findsOneWidget);
    expect(find.text(bidiSafeText('عدد الفساتين (Dresses / Gowns)'), findRichText: true), findsOneWidget);

    // «متابعة» والنوع الأساسي ناقص ⇒ مابيخرجش، والرسالة تحت الحقل نفسه.
    final continueButton = find.text('متابعة — اختار الميعاد');
    await tester.scrollUntilVisible(continueButton, 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(continueButton);
    await _settle(tester);
    expect(result, isNull);
    final missingMessage = find.text('اختار «نوع الخدمة الأساسي» علشان نقدر نحسب السعر.');
    expect(missingMessage, findsOneWidget);
    // الشاشة اتمرّرت لفوق للحقل الناقص — الرسالة ظاهرة فعلًا في الشاشة.
    expect(missingMessage.hitTestable(), findsOneWidget);

    await tester.tap(find.text('غسيل + كي').first);
    await tester.pump();
    final plus = find.byTooltip('زوّد');
    await tester.ensureVisible(plus.first);
    await tester.tap(plus.first);
    await tester.pump();
    await tester.tap(plus.first);
    await tester.pump();
    expect(find.text('2 قميص'), findsOneWidget);
    await tester.scrollUntilVisible(continueButton, 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(continueButton);
    await _settle(tester);

    expect(result, isNotNull, reason: 'بعد ملء الإجباري الشاشة لازم ترجّع الناتج');
    final values = result!.fieldValues;
    expect(values['main_type'], 'wash_iron', reason: 'القيمة المبعوتة هي option.value زي ما هي');
    expect(values['shirts'], isA<int>(), reason: 'العدّاد int من المصدر');
    expect(values['shirts'], 2);
    expect(values['shirts_type'], 'same_as_main', reason: 'الافتراضي اللي الأدمن ضبطه بيتبعت (نفس تهيئة الويب)');
    expect(values.containsKey('dresses'), isFalse, reason: 'العدّاد الاختياري اللي ما اتلمسش مابيتبعتش');

    // ── الطلب من OrdersRepository الحقيقي ──
    final repo = OrdersRepository(auth);
    final order = await _real(
      tester,
      () => repo.create(
        serviceId: serviceId,
        addressId: address.id,
        bookingMode: BookingMode.individual,
        scheduledAt: bookableScheduledAt(),
        problemDescription: 'فيه جاكيت عليه بقعة زيت',
        fieldValues: values,
        idempotencyKey: 'ux-e2e-${DateTime.now().microsecondsSinceEpoch}',
      ),
    );
    final snapshot = jsonDecode(_psql("SELECT customer_inputs::text FROM orders WHERE id='${order.id}'")) as List;
    final byKey = {for (final i in snapshot.cast<Map<String, dynamic>>()) i['key']: i};
    expect(byKey['shirts']?['value'], '2', reason: 'مفيش كسور في القيمة المخزّنة');
    expect(byKey['shirts']?['integer_quantity'], isTrue);
    expect(byKey['shirts_type']?['is_default'], isTrue);
    expect(byKey['main_type']?['is_required'], isTrue);
    expect(byKey['main_type']?['value'], 'غسيل + كي');
    expect(
      _psql("SELECT duration_minutes FROM orders WHERE id='${order.id}'"),
      '1',
      reason: 'duration_minutes بيفضل قيمة الجدولة زي ما هي',
    );
    // الـscheduler بيحسب فترة الانشغال من `duration_minutes` (`order-schedule-interval.ts`) —
    // `scheduled_end_at` بيتملى لنطاق أيام بس، فهنا null ومفيش حاجة غيّرت مدخل الجدولة.
    expect(_psql("SELECT scheduled_end_at IS NULL FROM orders WHERE id='${order.id}'"), 't');

    // تفاصيل الطلب في التطبيق: المدة التشغيلية مابتتعرضش كمدة تنفيذ.
    final detail = await _real(tester, () => repo.getOne(order.id));
    expect(detail.durationMinutes, 1);
    expect(formatWorkDuration(minutes: detail.durationMinutes, days: detail.estimatedDurationDays), isNull);

    // ── وقت برّه النافذة الجديدة (٥ م القاهرة) بيترفض من السيرفر ──
    final now = DateTime.now().toUtc();
    final outside = DateTime.utc(now.year, now.month, now.day + 3, 15).toIso8601String();
    Object? rejection;
    await _real(tester, () async {
      try {
        await repo.create(
          serviceId: serviceId,
          addressId: address.id,
          bookingMode: BookingMode.individual,
          scheduledAt: outside,
          fieldValues: values,
          idempotencyKey: 'ux-e2e-out-${DateTime.now().microsecondsSinceEpoch}',
        );
      } catch (err) {
        rejection = err;
      }
    });
    expect(rejection, isNotNull, reason: 'السيرفر هو الحارس: ٥ م برّه نافذة ٨ ص – ٤ م');

    // ── واتساب الدعم من الإعدادات الحقيقية ──
    await tester.pumpWidget(const MaterialApp(home: SupportContactScreen()));
    await _settle(tester);
    expect(find.text('تواصل معنا على واتساب'), findsOneWidget);
    expect(find.text('تذاكر الدعم'), findsOneWidget);
    expect(find.text('شات الدعم'), findsOneWidget);
    expect(footerSupportUri(_supportPhone).toString(), 'https://wa.me/201505988990');

    if (_handoffMode) {
      handoffFile.writeAsStringSync(
        jsonEncode({
          'order_id': order.id,
          'service_id': serviceId,
          'customer_token': auth.accessToken,
          'address_id': address.id,
        }),
      );
    }
  });
}
