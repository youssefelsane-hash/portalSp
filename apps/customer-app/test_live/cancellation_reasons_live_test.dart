// اختبار حي حقيقي لميزة أسباب الإلغاء + رسوم الإلغاء (كانت فجوة موثّقة في apps/api، اتقفلت،
// والواجهة هنا اتوصّلت بيها في نفس الجلسة). نفس نمط order_creation_live_test.dart — apiRequest
// مباشرة، مش AuthRepository/OrdersRepository، لنفس سبب تعارض flutter_secure_storage.
// شغّله بـ: flutter test test_live/cancellation_reasons_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';


void main() {
  test('عميل حقيقي يشوف أسباب الإلغاء ويلغي طلب برسوم حقيقية من محفظته', () async {
    // MFA بقى إجباري لحسابات الأدمن (ADR-0011)، فمسار الـOTP بيرجّع `mfa_required` من غير
    // توكن. التوقيع المحلي هو نفس الطريقة المعتمدة في اختبارات الأدمن الحية — تفاصيل في
    // `_live_support.dart`.
    const adminPhone = '+201000000001';
    final adminToken = await devAdminToken(adminPhone);
    final customerToken = await registerCustomer(uniquePhone());

    // 1) القايمة العامة (مفيش accessToken هنا عمداً — @Public() في الباك-إند)
    var customerReasons = await apiRequestList('/cancellation-reasons?applies_to=customer');
    expect(customerReasons, isNotEmpty, reason: 'لازم يكون فيه سبب واحد على الأقل');

    // **الاختبار بيجهّز شرطه بنفسه (تدقيق §148)**: كل أسباب الإلغاء المزروعة رسومها صفر، وده
    // قرار سياسة للأدمن مش بَقّة — فالاختبار كان بيقع على `StateError` بدل ما يختبر حاجة.
    // بدل ما نستنى بيانات من سيشن تانية، بنعمل السبب برسوم عبر **مسار الأدمن الحقيقي** (ده
    // بيغطي الـendpoint كمان)، وبنعطّله في الآخر عشان مانغيّرش سياسة القاعدة.
    String? createdFeeReasonId;
    if (!customerReasons.any((r) => r['charges_fee'] == true)) {
      final created = await apiRequest('POST', '/admin/cancellation-reasons',
          accessToken: adminToken, extraHeaders: await stepUpHeader(adminPhone), body: {
        'reason_ar': 'إلغاء متأخر (اختبار حي)',
        'reason_en': 'Late cancellation (live test)',
        'applies_to': 'customer',
        'charges_fee': true,
        'fee_percentage': 10,
      });
      createdFeeReasonId = created!['id'] as String;
      customerReasons = await apiRequestList('/cancellation-reasons?applies_to=customer');
    }

    final feeReason = customerReasons.firstWhere(
      (r) => r['charges_fee'] == true,
      orElse: () => throw StateError('محتاجين سبب فيه رسوم لاختبار الحساب'),
    );
    final feePercentage = (feeReason['fee_percentage'] as num).toDouble();

    final technicianReasons = await apiRequestList('/cancellation-reasons?applies_to=technician');
    expect(technicianReasons, isNotEmpty);
    expect(technicianReasons.every((r) => r['applies_to'] == 'technician'), isTrue);

    // 2) نافذة الإلغاء المجاني اتصغّرت لصفر مؤقتاً عشان الرسوم تتطبّق فوراً وقت الاختبار
    final windowBefore = await apiRequest(
      'GET',
      '/admin/settings/orders.cancellation_free_window_min',
      accessToken: adminToken,
    );
    final originalWindow = windowBefore!['value'];
    await apiRequest(
      'PATCH',
      '/admin/settings/orders.cancellation_free_window_min',
      accessToken: adminToken,
      extraHeaders: await stepUpHeader(adminPhone),
      body: {'value': 0},
    );

    try {
      // العميل بقى جديد كل تشغيلة، فمفيش طلبات سابقة يتاخد منها عنوان — بيتعمل واحد حقيقي.
      // والخدمة لازم تكون **بلا حقول تسعير إجبارية** (§148).
      final serviceId = await pickBookableServiceId();
      final addressId = await ensureAddressFor(customerToken);

      final walletBefore = await apiRequest('GET', '/wallet', accessToken: customerToken);
      final balanceBefore = walletBefore!['balance_cents'] as int;

      // **وصف مختلف لكل طلب مقصود**: حارس تكرار الطلب (`order-duplicate-guard.ts`) بيشتق مفتاح
      // من بصمة الطلب + شريحة زمنية، فطلبين متطابقين في نفس النافذة بيرجّعوا **نفس الصف**.
      // من غير ده، الطلب التاني كان بيطلع هو الأول (المُلغى خلاص) والتنضيف يفشل (§148).
      final order = await apiRequest(
        'POST',
        '/orders',
        accessToken: customerToken,
        body: {'service_id': serviceId, 'scheduled_at': bookableScheduledAt(), 'address_id': addressId, 'problem_description': 'اختبار رسوم الإلغاء — طلب ١'},
      );
      final orderId = order!['id'] as String;
      final totalCents = order['total_amount_cents'] as int;
      final expectedFee = (totalCents * feePercentage / 100).round();

      final cancelled = await apiRequest(
        'POST',
        '/orders/$orderId/cancel',
        accessToken: customerToken,
        body: {'cancellation_reason_id': feeReason['id'], 'reason': 'اختبار حي من الواجهة'},
      );
      expect(cancelled!['order_status'], 'cancelled_by_customer');
      expect(cancelled['cancellation_fee_cents'], expectedFee);
      expect(cancelled['cancellation_reason_id'], feeReason['id']);

      final walletAfter = await apiRequest('GET', '/wallet', accessToken: customerToken);
      final balanceAfter = walletAfter!['balance_cents'] as int;
      expect(balanceAfter, balanceBefore - expectedFee);

      // سبب applies_to=technician مرفوض لإلغاء عميل
      final order2 = await apiRequest(
        'POST',
        '/orders',
        accessToken: customerToken,
        body: {'service_id': serviceId, 'scheduled_at': bookableScheduledAt(), 'address_id': addressId, 'problem_description': 'اختبار رفض سبب الفني — طلب ٢'},
      );
      final order2Id = order2!['id'] as String;
      await expectLater(
        apiRequest(
          'POST',
          '/orders/$order2Id/cancel',
          accessToken: customerToken,
          body: {'cancellation_reason_id': technicianReasons.first['id']},
        ),
        throwsA(isA<ApiException>()),
      );
      // تنظيف الطلب اللي فضل مفتوح بسبب المحاولة المرفوضة
      await apiRequest('POST', '/orders/$order2Id/cancel', accessToken: customerToken, body: {'reason': 'تنظيف', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
    } finally {
      await apiRequest(
        'PATCH',
        '/admin/settings/orders.cancellation_free_window_min',
        accessToken: adminToken,
        extraHeaders: await stepUpHeader(adminPhone),
        body: {'value': originalWindow},
      );
    }

    // تعطيل السبب اللي الاختبار عمله — مانسيبش سياسة إلغاء جديدة ورانا في القاعدة.
    if (createdFeeReasonId != null) {
      await apiRequest('PATCH', '/admin/cancellation-reasons/$createdFeeReasonId',
          accessToken: adminToken, extraHeaders: await stepUpHeader(adminPhone), body: {'is_active': false});
    }
  }, timeout: const Timeout(Duration(seconds: 120)));
}
