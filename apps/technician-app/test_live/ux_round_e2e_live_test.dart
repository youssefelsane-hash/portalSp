// **تكملة التحقق End-to-End لجولة UX عند مقدم الخدمة** (docs/08 §185).
//
// بيكمّل على **نفس الطلب** اللي `apps/customer-app/test_live/ux_round_e2e_live_test.dart` عمله من
// كود تطبيق العميل الحقيقي (ملف تسليم). هنا: فني حقيقي في قاعدة البيانات، توكن حقيقي،
// `OrdersRepository.getOne` الحقيقي، والكارت الحقيقي (`OrderBriefCard`) — وبنتأكد إن:
//   - اختيارات العميل بتوصل منظمة، والافتراضي مطوي، والعدّاد بالرقم الصحيح.
//   - العمارة/الدور/الشقة/العلامة/ملاحظات الوصول بتوصل — وبس جوّه سياسة ظهور بيانات العميل.
//   - «المطلوب» (رسالة العميل من التطبيق) و`customer_notes` بيوصلوا.
//   - مدة الجدولة (دقيقة) مابتتعرضش، والملاحة بالإحداثيات.
//   - طلب قديم (snapshot بلا metadata بقيمة كسرية) وعنوان قديم (بلا تفاصيل) مابيكسروش حاجة.
//
// التشغيل بالترتيب: `scripts/verify-ux-round-e2e.sh`.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/auth_repository.dart';
import 'package:technician_app/features/orders/order.dart';
import 'package:technician_app/features/orders/order_brief_card.dart';
import 'package:technician_app/features/orders/orders_repository.dart';

import '_live_support.dart';

final handoffFile = File('${Directory.systemTemp.path}/osta-ux-round-e2e.json');

/// بيتشغّل بس كتكملة لنص العميل (`scripts/verify-ux-round-e2e.sh`) — لوحده مالوش طلب يقراه. العلم
/// صريح مش وجود الملف: ملف قديم من تشغيلة وقعت بيشاور على طلب اتمسح.
const _skipReason = bool.fromEnvironment('UX_E2E_HANDOFF')
    ? null
    : 'تكملة لنص العميل: شغّل scripts/verify-ux-round-e2e.sh';

class _LiveAuth extends AuthRepository {
  _LiveAuth(this._token);
  final String _token;
  @override
  String? get accessToken => _token;
  @override
  Future<Map<String, dynamic>?> authedRequest(String method, String path, {Map<String, dynamic>? body}) =>
      apiRequest(method, path, body: body, accessToken: _token);
  @override
  Future<List<Map<String, dynamic>>> authedRequestList(String path) => apiRequestList(path, accessToken: _token);
}

String _sql(String sql) {
  final result = Process.runSync(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', 'baytak_main', '-Atc', sql],
    environment: {'PGPASSWORD': 'baytak'},
  );
  if (result.exitCode != 0) throw StateError('psql: ${result.stderr}');
  return (result.stdout as String).trim().split('\n').first.trim();
}

/// نداء عميل (تطبيق الفني مابيعملش طلبات، فالـclient بتاعه مالوش هيدرات مخصصة زي Idempotency-Key).
Future<Map<String, dynamic>> _customerPost(String path, String token, Map<String, dynamic> body) async {
  const base = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000/api/v1');
  final client = HttpClient();
  try {
    final request = await client.postUrl(Uri.parse('$base$path'));
    request.headers
      ..contentType = ContentType.json
      ..set('Authorization', 'Bearer $token')
      ..set('Idempotency-Key', 'ux-e2e-notes-${DateTime.now().microsecondsSinceEpoch}');
    request.add(utf8.encode(jsonEncode(body)));
    final response = await request.close();
    final decoded = jsonDecode(await response.transform(utf8.decoder).join()) as Map<String, dynamic>;
    if (response.statusCode >= 400) throw StateError('POST $path ⇒ ${response.statusCode}: ${decoded['error']}');
    return decoded['data'] as Map<String, dynamic>;
  } finally {
    client.close();
  }
}

late Map<String, dynamic> handoff;
late String technicianProfileId;
late OrdersRepository repo;

Future<Order> _load(WidgetTester tester, String orderId) async => (await tester.runAsync(() => repo.getOne(orderId)))!;

Future<void> _card(WidgetTester tester, Order order) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: SingleChildScrollView(
            child: OrderBriefCard(order: order, onNavigate: () {}),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  setUpAll(() async {
    HttpOverrides.global = null;
    if (_skipReason != null) return;
    if (!handoffFile.existsSync()) throw StateError('ملف التسليم من نص العميل مش موجود');
    handoff = jsonDecode(handoffFile.readAsStringSync()) as Map<String, dynamic>;

    // فني حقيقي في قاعدة البيانات (نفس جداول الإنتاج)، والطلب متعيّن عليه ومقبول.
    final phone = uniquePhone();
    final userId = _sql(
      "INSERT INTO users (phone_number, full_name, user_type) VALUES ('$phone', 'فني E2E جولة UX', 'technician') RETURNING id",
    );
    technicianProfileId = _sql(
      "INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, technician_kind) "
      "VALUES ('$userId', 'UXE2E${DateTime.now().millisecondsSinceEpoch % 100000000}', 'premium', 'approved', true, true, 'technician') RETURNING id",
    );
    _sql(
      "UPDATE orders SET technician_id = '$technicianProfileId', order_status = 'accepted' WHERE id = '${handoff['order_id']}'",
    );
    repo = OrdersRepository(_LiveAuth(devTokenForUserId(userId)));
  });

  testWidgets('E2E: طلب العميل بيوصل للفني منظم وكامل', skip: _skipReason != null, (tester) async {
    tester.view.physicalSize = const Size(390, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final order = await _load(tester, handoff['order_id'] as String);

    // ── الموديل قرا الـmetadata ──
    final byKey = {for (final input in order.customerInputs) input.key: input};
    expect(byKey['shirts']?.integerQuantity, isTrue);
    expect(byKey['shirts']?.value, '2');
    expect(byKey['shirts_type']?.isDefault, isTrue);
    expect(byKey['main_type']?.isRequired, isTrue);
    expect(order.problemDescription, 'فيه جاكيت عليه بقعة زيت');
    expect(order.durationMinutes, 1);

    // ── العنوان كامل (accepted = جوّه سياسة الظهور) ──
    final address = order.address!;
    expect(address.unitLine, 'عمارة 15 · الدور 3 · شقة 7');
    expect(address.landmark, 'جنب شركة الكهرباء');
    expect(address.deliveryNotes, 'الجرس مش شغال، كلمني قبل ما تطلع');
    expect(address.navigationUri.queryParameters['destination'], '${address.latitude},${address.longitude}');

    // ── الكارت الحقيقي ──
    await _card(tester, order);
    expect(find.text('غسيل + كي'), findsOneWidget);
    expect(find.text('2 قميص'), findsOneWidget);
    expect(find.text('نفس الخدمة الأساسية'), findsNothing, reason: 'الافتراضي مطوي');
    expect(find.textContaining('عرض كل الاختيارات'), findsOneWidget);
    expect(find.text('المطلوب'), findsOneWidget);
    expect(find.text('فيه جاكيت عليه بقعة زيت'), findsOneWidget);
    expect(find.text('عمارة 15 · الدور 3 · شقة 7'), findsOneWidget);
    expect(find.text('ملاحظات الوصول'), findsOneWidget);
    expect(find.text('الجرس مش شغال، كلمني قبل ما تطلع'), findsOneWidget);
    expect(find.textContaining('المدة المتوقعة'), findsNothing, reason: 'دقيقة الجدولة مش مدة تنفيذ');
    expect(find.text('ملاحظات العميل'), findsNothing, reason: 'مفيش customer_notes على الطلب ده');
    expect(tester.takeException(), isNull);

    // ── برّه سياسة الظهور: الشارع والإحداثيات بس ──
    _sql("UPDATE orders SET order_status = 'technician_assigned' WHERE id = '${handoff['order_id']}'");
    final assigned = await _load(tester, handoff['order_id'] as String);
    expect(assigned.address!.unitLine, isNull);
    expect(assigned.address!.deliveryNotes, isNull);
    expect(assigned.address!.streetName, 'شارع التعاونيات');
    await _card(tester, assigned);
    expect(find.textContaining('شقة'), findsNothing);
    expect(find.text('ملاحظات الوصول'), findsNothing);
    _sql("UPDATE orders SET order_status = 'accepted' WHERE id = '${handoff['order_id']}'");

    // ── customer_notes: المنتِج الوحيد ليه النهارده عقد الـAPI (`POST /orders`) ──
    final withNotes = await tester.runAsync(
      () => _customerPost('/orders', handoff['customer_token'] as String, {
        'service_id': handoff['service_id'],
        'address_id': handoff['address_id'],
        'booking_mode': 'individual',
        'scheduled_at': bookableScheduledAt(daysAhead: 3),
        'field_values': {'main_type': 'iron_only', 'shirts': 1},
        'customer_notes': 'هاسيب الهدوم مع البواب',
      }),
    );
    final notesOrderId = withNotes!['id'] as String;
    _sql(
      "UPDATE orders SET technician_id = '$technicianProfileId', order_status = 'accepted' WHERE id = '$notesOrderId'",
    );
    final notesOrder = await _load(tester, notesOrderId);
    expect(notesOrder.customerNotes, 'هاسيب الهدوم مع البواب');
    await _card(tester, notesOrder);
    expect(find.text('ملاحظات العميل'), findsOneWidget);
    expect(find.text('هاسيب الهدوم مع البواب'), findsOneWidget);

    // ── طلب قديم: snapshot بلا metadata بقيمة كسرية + عنوان بلا تفاصيل ──
    _sql(
      "UPDATE orders SET customer_inputs = '[{\"key\":\"shirts\",\"label\":\"عدد القمصان\",\"value\":\"1.9639846991701237\",\"unit\":\"قميص\"},"
      "{\"key\":\"t\",\"label\":\"عدد التيشيرتات\",\"value\":\"0\",\"unit\":\"حدد إجمالي عدد التيشيرتات والبولو في الطلب.\"}]'::jsonb "
      "WHERE id = '$notesOrderId'",
    );
    _sql(
      "UPDATE addresses SET building_number = NULL, floor_number = NULL, apartment_number = NULL, delivery_notes = NULL "
      "WHERE id = '${handoff['address_id']}'",
    );
    final legacy = await _load(tester, notesOrderId);
    expect(legacy.customerInputs.every((i) => !i.hasMetadata), isTrue);
    await _card(tester, legacy);
    // من غير metadata مفيش تقريب ولا إخفاء (مابنخمّنش) — بس الشرح الطويل مابيتعرضش كوحدة.
    expect(find.text('1.9639846991701237 قميص'), findsOneWidget);
    expect(find.text('عدد التيشيرتات'), findsOneWidget);
    expect(find.textContaining('حدد إجمالي'), findsNothing);
    expect(find.textContaining('عمارة'), findsNothing);
    expect(find.text('ملاحظات الوصول'), findsNothing);
    expect(find.text('جنب شركة الكهرباء'), findsOneWidget, reason: 'العلامة لسه موجودة في العنوان القديم');
    expect(tester.takeException(), isNull);
  });
}
