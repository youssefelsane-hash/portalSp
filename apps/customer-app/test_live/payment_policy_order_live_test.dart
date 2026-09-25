// **حارس انحدار للبَقّة الحقيقية**: تطبيق العميل كان بيبعت `POST /orders` من غير
// `accepted_policy_version_ids` خالص، فأي سياسة إجبارية من نوع `postpaid_service` كانت بتخلّي
// الحجز من **الموقع** ينجح ومن **التطبيق** يترفض — اختلاف سلوك بين قناتين على نفس الطلب.
//
// الاختبار بيثبت الاتجاهين على API حقيقي: من غير القبول الطلب **بيترفض**، ومع القبول **بينجح**.
// من غير الفرع السلبي ده الاختبار كان هيعدّي حتى لو الإصلاح اتشال تاني.
//
// شغّله بـ:
//   flutter test test_live/payment_policy_order_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';

void main() {
  test('سياسة دفع إجبارية: الطلب يترفض من غير قبول وينجح بالقبول', () async {
    final adminToken = await devAdminToken('+201000000001');
    final serviceId = await pickBookableServiceId();
    final slug = 'live-postpaid-${DateTime.now().microsecondsSinceEpoch}';

    // سياسة **مربوطة بالخدمة دي بالذات** عشان ماتأثرش على أي اختبار تاني بيجري بالتوازي.
    final policy = await apiRequest(
      'POST',
      '/admin/payment-policies',
      accessToken: adminToken,
      body: {
        'slug': slug,
        'title_ar': 'شروط الدفع بعد الخدمة (اختبار حي)',
        'applies_to': 'postpaid_service',
        'target_service_id': serviceId,
        'is_required': true,
        'body_ar':
            'ده نص شروط اختبار حي للدفع بعد إتمام الخدمة، وطوله كافي عشان الباك-إند يقبله.',
      },
    );
    final policyId = policy!['id'] as String;

    try {
      final accessToken = await registerCustomer(uniquePhone());
      final addressId = await ensureAddressFor(accessToken);

      Map<String, dynamic> orderBody() => {
            'service_id': serviceId,
            'address_id': addressId,
            'scheduled_at': bookableScheduledAt(),
            'booking_mode': 'individual',
          };

      // ── ١) السلوك القديم للتطبيق: بلا قبول ⇒ رفض ─────────────────────────────────
      Object? rejection;
      try {
        await apiRequest('POST', '/orders',
            accessToken: accessToken, body: orderBody());
      } catch (e) {
        rejection = e;
      }
      expect(rejection, isNotNull,
          reason: 'السيرفر المفروض يرفض الطلب من غير قبول الشروط');
      expect(rejection.toString(), contains('شروط الدفع'));

      // ── ٢) السياسات بتوصل للعميل من نفس المسار اللي التطبيق بيستعمله ─────────────
      final policies = await apiRequestList(
        '/checkout/payment-policies?applies_to=postpaid_service&service_id=$serviceId',
      );
      final mine = policies.firstWhere((p) => p['policyId'] == policyId);
      expect(mine['isRequired'], isTrue);
      expect(mine['currentVersionId'], isNotNull);

      // ── ٣) السلوك الجديد: مع القبول ⇒ نجاح ───────────────────────────────────────
      final order = await apiRequest(
        'POST',
        '/orders',
        accessToken: accessToken,
        body: {
          ...orderBody(),
          'accepted_policy_version_ids': [mine['currentVersionId']],
        },
      );
      expect(order, isNotNull);
      expect(order!['id'], isNotNull);
    } finally {
      // إلغاء تفعيل السياسة مهما حصل — سياسة إجبارية متسيبة شغّالة بتكسر كل اختبار حجز بعدها.
      await apiRequest('PATCH', '/admin/payment-policies/$policyId',
          accessToken: adminToken, body: {'is_active': false});
    }
  });
}
