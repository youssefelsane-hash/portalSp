// اختبار حي حقيقي لربط محرك التسعير الديناميكي (docs/08 §1) بمسار إنشاء الطلب — كانت أخطر فجوة
// تسعير موثّقة في المشروع (طلبات formula كانت بتتحجز مجانًا بصمت، تفاصيل كاملة في
// apps/api/src/modules/pricing/README.md). مختلف عن باقي test_live بإنه **بيبني fixture الخدمة
// بنفسه** (خدمة formula + 4 حقول + 3 قواعد تسعير عبر /admin) بدل ما يعتمد على id ثابت من سيشن
// تانية — أكتر استقرارًا عبر السيشنز المختلفة اللي بتشتغل بالتبادل على المشروع ده.
// شغّله بـ: flutter test test_live/pricing_engine_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber, File log) async {
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _loginAs(String phoneNumber, File log) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber, log);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('عميل حقيقي يحجز خدمة formula-priced، السعر الفعلي للطلب يطابق evaluate-price بالظبط', () async {
    // ملحوظة تشغيل: عدّل مسار اللوج ده لملف log السيرفر الفعلي بتاع السيشن اللي بتشغّل الاختبار
    // فيها (نفس القيد الموجود في order_creation_live_test.dart/addon_order_creation_live_test.dart
    // — مسار ثابت لمجلد scratchpad الخاص بسيشن Claude Code معيّنة).
    final serverLog = File(Platform.environment['API_SERVER_LOG'] ?? '/tmp/server.log');

    final adminToken = await _loginAs('+201000000098', serverLog);
    final customerToken = await _loginAs('+201000000101', serverLog);

    // إنشاء خدمة formula حقيقية جديدة بمثال المحارة من docs/08 §1.8 بالحرف — مساحة×سعر_المتر
    // + 15% لو السمك 3سم + 500 قرش لو الدور>5.
    final categories = await apiRequestList('/service-categories');
    expect(categories, isNotEmpty);
    final categoryId = categories.first['id'] as String;

    final service = await apiRequest('POST', '/admin/services', accessToken: adminToken, body: {
      'category_id': categoryId,
      'name_ar': 'محارة (اختبار Dart حي)',
      'slug': 'plastering-dart-live-test-${DateTime.now().millisecondsSinceEpoch}',
      'pricing_model': 'formula',
      'base_price_cents': 0,
      'allows_individual': true,
    });
    final serviceId = service!['id'] as String;

    Future<void> createField(Map<String, dynamic> body) =>
        apiRequest('POST', '/admin/services/$serviceId/pricing-fields', accessToken: adminToken, body: body);
    await createField({'field_key': 'area', 'label_ar': 'المساحة', 'field_type': 'area', 'is_required': true, 'min_value': 1});
    await createField({'field_key': 'floor', 'label_ar': 'الدور', 'field_type': 'number', 'is_required': false, 'min_value': 0});
    await createField({
      'field_key': 'thickness_cm', 'label_ar': 'السمك', 'field_type': 'dropdown', 'is_required': true,
      'options': [{'value': '2', 'label_ar': '2 سم'}, {'value': '3', 'label_ar': '3 سم'}],
    });
    await createField({
      'field_key': 'wall_type', 'label_ar': 'نوع المحارة', 'field_type': 'dropdown', 'is_required': true,
      'options': [{'value': 'internal', 'label_ar': 'داخلي'}, {'value': 'external', 'label_ar': 'خارجي'}],
    });

    Future<void> upsertRule(Map<String, dynamic> body) =>
        apiRequest('PUT', '/admin/services/$serviceId/pricing-rules', accessToken: adminToken, body: body);
    await upsertRule({
      'rule_type': 'lookup_table', 'rule_key': 'price_per_meter',
      'payload': {'field_key': 'wall_type', 'values': {'internal': 140, 'external': 165}},
    });
    await upsertRule({'rule_type': 'constant', 'rule_key': 'floor_surcharge', 'payload': {'value': 500}});
    await upsertRule({
      'rule_type': 'formula', 'rule_key': 'final_price',
      'payload': {
        'price_cents': {
          'type': 'add',
          'operands': [
            {
              'type': 'if',
              'condition': {'field_key': 'thickness_cm', 'op': 'equals', 'value': 3},
              'then': {
                'type': 'percentage', 'percent': {'type': 'literal', 'value': 15},
                'base': {'type': 'multiply', 'operands': [
                  {'type': 'field_ref', 'field_key': 'area'},
                  {'type': 'lookup_ref', 'rule_key': 'price_per_meter', 'field_key': 'wall_type'},
                ]},
              },
              'else': {'type': 'multiply', 'operands': [
                {'type': 'field_ref', 'field_key': 'area'},
                {'type': 'lookup_ref', 'rule_key': 'price_per_meter', 'field_key': 'wall_type'},
              ]},
            },
            {
              'type': 'if',
              'condition': {'field_key': 'floor', 'op': 'gt', 'value': 5},
              'then': {'type': 'constant_ref', 'rule_key': 'floor_surcharge'},
              'else': {'type': 'literal', 'value': 0},
            },
          ],
        },
      },
    });

    final fieldValues = {'area': 10, 'wall_type': 'internal', 'thickness_cm': '3', 'floor': 6};
    // 10×140=1400 + 15%=210 + 500 (دور>5) = 2110
    const expectedPriceCents = 2110;

    // evaluate-price (CatalogRepository.evaluatePrice المستخدمة فعليًا في CreateOrderScreen للمعاينة الحية)
    final evaluation = await apiRequest(
      'POST',
      '/services/$serviceId/evaluate-price',
      body: {'field_values': fieldValues},
    );
    expect(evaluation!['price_cents'], expectedPriceCents);

    // العنوان
    final cities = await apiRequestList('/cities');
    final areas = await apiRequestList('/cities/${cities.first['id']}/areas');
    final address = await apiRequest('POST', '/addresses', accessToken: customerToken, body: {
      'city_id': cities.first['id'],
      'area_id': areas.first['id'],
      'street_name': 'شارع اختبار محرك التسعير',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'اختبار Dart حي',
    });
    final addressId = address!['id'] as String;

    // POST /orders (OrdersRepository.create مع field_values — الإصلاح الفعلي محل الاختبار)
    final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
      'service_id': serviceId,
      'address_id': addressId,
      'field_values': fieldValues,
    });
    expect(order, isNotNull);
    expect(order!['estimated_price_cents'], expectedPriceCents, reason: 'السعر الفعلي للطلب لازم يطابق معاينة evaluate-price بالظبط، مش صفر صامت');
    expect(order['total_amount_cents'], expectedPriceCents);
    final orderId = order['id'] as String;

    // طلب من غير field_values لازم يترفض بوضوح (مش يتحجز بصفر بصمت)
    var rejected = false;
    try {
      await apiRequest('POST', '/orders', accessToken: customerToken, body: {
        'service_id': serviceId,
        'address_id': addressId,
      });
    } catch (_) {
      rejected = true;
    }
    expect(rejected, isTrue, reason: 'طلب formula من غير field_values المطلوبة لازم يترفض، مش يتحجز مجانًا');

    // تنظيف
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'تنظيف بيانات اختبار حي'});
    await apiRequest('DELETE', '/addresses/$addressId', accessToken: customerToken);
    await apiRequest('DELETE', '/admin/services/$serviceId', accessToken: adminToken);
  });
}
