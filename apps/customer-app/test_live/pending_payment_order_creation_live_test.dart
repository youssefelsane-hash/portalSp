// اختبار حي حقيقي لدفع قبل التوزيع (ADR-0013، docs/08 §19 بند 1) ضد apps/api الشغال فعلاً —
// نفس أسلوب order_creation_live_test.dart بالحرف. بيثبت إن OrdersRepository.create()'s
// paymentMethod الجديد وPaymentsRepository.payWithInstaPay() الجديدة بيتفاهموا صح مع الباك-إند
// الحقيقي (مش بس منطق الباك-إند نفسه، ده مختبر أصلاً في apps/api/src/modules/orders — هنا
// بنتأكد إن الـwire format اللي customer-app بيبعته مفهوم صح من الطرف التاني).
// شغّله بـ: flutter test test_live/pending_payment_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';

// **ADR-0109** — التسجيل بقى نداء واحد بلا لوج وبلا انتظار. النسخة القديمة كانت بتنسخ
// الهارنس بالإيد، وجابت معاها بَقّة الأرقام المتصادمة اللي `uniquePhone()` اتعملت عشانها
// (`millisecondsSinceEpoch % 100000000` بتتغيّر مرة كل ١٠٠ مللي، والملفات بتشتغل بالتوازي).
Future<String> _registerAndLogin() => registerCustomer(uniquePhone(), fullName: 'عميل اختبار حي دفع مسبق');

void main() {
  test('عميل حقيقي يختار دفع قبل التوزيع (كارت وInstaPay) وقت إنشاء الطلب', () async {
    final accessToken = await _registerAndLogin();

    final cities = await apiRequestList('/cities');
    expect(cities, isNotEmpty);
    final cityId = cities.first['id'] as String;
    final areas = await apiRequestList('/cities/$cityId/areas');
    expect(areas, isNotEmpty);
    final areaId = areas.first['id'] as String;

    final address = await apiRequest(
      'POST',
      '/addresses',
      accessToken: accessToken,
      body: {
        'city_id': cityId,
        'area_id': areaId,
        'street_name': 'شارع اختبار دفع مسبق',
        'latitude': 30.0444,
        'longitude': 31.2357,
        'label': 'اختبار flutter live — دفع مسبق',
      },
    );
    final addressId = address!['id'] as String;

    // أول خدمة **بلا حقول تسعير إجبارية**: أول خدمة في الكتالوج ممكن تكون formula
    // محتاجة «المساحة» فالطلب بيترفض لسبب مالوش علاقة بالمُختبَر (§148).
    final serviceId = await pickBookableServiceId();

    // (أ) كارت — الطلب لازم يرجع pending_payment (مش searching_technician زي الافتراضي).
    // بيئة التطوير دي مفيهاش بيانات اعتماد Paymob حقيقية (docs/03-external-integrations.md)،
    // فـpay-with-card المفروض يرفض بوضوح (PAY_001, 503) مش ينهار أو يتظاهر بالنجاح — ده بالظبط
    // اللي بيثبت إن الـwire format اللي customer-app بيبعته (orderId + Idempotency-Key header)
    // وصل صح للباك-إند ولقى provider حقيقي اتفحص فعليًا (مش خطأ مسار/404).
    final cardOrder = await apiRequest(
      'POST',
      '/orders',
      accessToken: accessToken,
      body: {
        'service_id': serviceId,
        'address_id': addressId,
        'problem_description': 'اختبار حي — دفع مسبق بالبطاقة',
        'payment_method': 'card',
      },
    );
    expect(cardOrder, isNotNull);
    expect(cardOrder!['order_status'], 'pending_payment');
    expect(cardOrder['payment_status'], 'unpaid');
    final cardOrderId = cardOrder['id'] as String;

    try {
      await apiRequest(
        'POST',
        '/orders/$cardOrderId/pay-with-card',
        accessToken: accessToken,
        extraHeaders: {'Idempotency-Key': 'live-test-card-${DateTime.now().microsecondsSinceEpoch}'},
      );
      fail('المفروض pay-with-card يرفض — مفيش بيانات اعتماد Paymob في بيئة التطوير دي');
    } on ApiException catch (err) {
      expect(err.statusCode, 503);
      expect(err.message, contains('مش متاح دلوقتي'));
    }

    await apiRequest('POST', '/orders/$cardOrderId/cancel', accessToken: accessToken, body: {
      'reason': 'تنظيف بيانات اختبار حي — دفع مسبق بالبطاقة',
      'cancellation_reason_id': await pickCustomerCancellationReasonId(),
    });

    // (ب) InstaPay — **السلوك بيتفرّع على الإعداد الحي، مش على افتراض مكتوب** (تدقيق §148):
    // الاختبار كان بيفترض إن InstaPay **مش** مُعدّ في بيئة التطوير ويطالب برفض 503. بعد ما
    // اتعدّ فعلاً (§12/§13)، الافتراض ده بقى غلط والاختبار بقى بيسقط على سلوك **صحيح**.
    // دلوقتي بيقرا الإعداد ويتأكد من العقد الصح في الحالتين — ده اللي بيخلّيه صالح في أي بيئة.
    final instapayOrder = await apiRequest(
      'POST',
      '/orders',
      accessToken: accessToken,
      body: {
        'service_id': serviceId,
        'address_id': addressId,
        'problem_description': 'اختبار حي — دفع مسبق InstaPay',
        'payment_method': 'instapay',
      },
    );
    expect(instapayOrder, isNotNull);
    expect(instapayOrder!['order_status'], 'pending_payment');
    final instapayOrderId = instapayOrder['id'] as String;

    // العقد الصح **في الحالتين**، من غير ما الاختبار يفترض حالة إعداد بعينها:
    //  • InstaPay مُعدّ  ⇒ بيرجّع تعليمات تحويل فيها عنوان IPA فعلي.
    //  • مش مُعدّ        ⇒ بيرفض 503 برسالة «مش متاح دلوقتي» (مش 500 ولا نجاح صامت).
    try {
      final transfer = await apiRequest(
        'POST',
        '/orders/$instapayOrderId/pay-with-instapay',
        accessToken: accessToken,
        extraHeaders: {'Idempotency-Key': 'live-test-instapay-${DateTime.now().microsecondsSinceEpoch}'},
      );
      expect(transfer, isNotNull, reason: 'نجح من غير ما يرجّع تعليمات تحويل');
      // `recipient_address` حقل مستقل عمدًا (طلب المالك 2026-09-11: الرقم في سطر لوحده) —
      // نجاح من غيره معناه إن العميل شايف تعليمات تحويل بلا حساب يحوّل عليه.
      expect(transfer!['recipient_address'], isNotNull, reason: 'نجاح بلا حساب استقبال = العميل مش عارف يحوّل لفين');
      expect(transfer['recipient_address'] as String, isNotEmpty);
      expect(transfer['reference_code'], isNotNull);
      expect(transfer['amount_cents'], isA<int>());
    } on ApiException catch (err) {
      expect(err.statusCode, 503, reason: 'الرفض لازم يكون 503 واضح مش 500');
      expect(err.message, contains('مش متاح دلوقتي'));
    }

    await apiRequest('POST', '/orders/$instapayOrderId/cancel', accessToken: accessToken, body: {
      'reason': 'تنظيف بيانات اختبار حي — دفع مسبق InstaPay',
      'cancellation_reason_id': await pickCustomerCancellationReasonId(),
    });

    // (ج) regression (طلب بلا payment_method لسه بيتصرف زي زمان — searching_technician فورًا)
    // مغطاة بالفعل بنفس الأسلوب في order_creation_live_test.dart، مش مكررة هنا عمدًا.

    await apiRequest('DELETE', '/addresses/$addressId', accessToken: accessToken);
  });
}
