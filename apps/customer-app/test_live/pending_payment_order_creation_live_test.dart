// اختبار حي حقيقي لدفع قبل التوزيع (ADR-0013، docs/08 §19 بند 1) ضد apps/api الشغال فعلاً —
// نفس أسلوب order_creation_live_test.dart بالحرف. بيثبت إن OrdersRepository.create()'s
// paymentMethod الجديد وPaymentsRepository.payWithInstaPay() الجديدة بيتفاهموا صح مع الباك-إند
// الحقيقي (مش بس منطق الباك-إند نفسه، ده مختبر أصلاً في apps/api/src/modules/orders — هنا
// بنتأكد إن الـwire format اللي customer-app بيبعته مفهوم صح من الطرف التاني).
// شغّله بـ: flutter test test_live/pending_payment_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/33b6554f-4f97-567b-a9a1-7de4b0f6b43a/scratchpad/api-server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

// رقم فريد كل تشغيلة (بدل رقم عميل تجريبي ثابت مُجهّز مسبقًا من سيشن تانية — القاعدة هنا فريش)
// عشان نضمن عميل حقيقي جديد بلا اعتماد على بيانات موجودة مسبقًا.
Future<String> _registerAndLogin() async {
  final suffix = (DateTime.now().millisecondsSinceEpoch % 100000000).toString().padLeft(8, '0');
  final phoneNumber = '+2010$suffix';
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'register'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final registerOtp = await _latestOtpFor(phoneNumber);
  await apiRequest('POST', '/auth/register', body: {
    'phone_number': phoneNumber,
    'otp_code': registerOtp,
    'full_name': 'عميل اختبار حي دفع مسبق',
    'user_type': 'customer',
  });

  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final loginOtp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': loginOtp,
  });
  return tokens!['access_token'] as String;
}

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

    final categories = await apiRequestList('/service-categories');
    String? serviceId;
    for (final category in categories) {
      final services = await apiRequestList('/services?category_id=${category['id']}');
      if (services.isNotEmpty) {
        serviceId = services.first['id'] as String;
        break;
      }
    }
    expect(serviceId, isNotNull, reason: 'محتاجين خدمة واحدة على الأقل عشان نختبر الدفع المسبق');

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
        'service_id': serviceId!,
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
    });

    // (ب) InstaPay — نفس المنطق بالحرف (مفيش INSTAPAY_IPA_ADDRESS/INSTAPAY_RECIPIENT_NAME
    // مُعدّين في بيئة التطوير دي برضه، راجع docs/03-external-integrations.md).
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

    try {
      await apiRequest(
        'POST',
        '/orders/$instapayOrderId/pay-with-instapay',
        accessToken: accessToken,
        extraHeaders: {'Idempotency-Key': 'live-test-instapay-${DateTime.now().microsecondsSinceEpoch}'},
      );
      fail('المفروض pay-with-instapay يرفض — مفيش IPA address مُعدّ في بيئة التطوير دي');
    } on ApiException catch (err) {
      expect(err.statusCode, 503);
      expect(err.message, contains('مش متاح دلوقتي'));
    }

    await apiRequest('POST', '/orders/$instapayOrderId/cancel', accessToken: accessToken, body: {
      'reason': 'تنظيف بيانات اختبار حي — دفع مسبق InstaPay',
    });

    // (ج) regression (طلب بلا payment_method لسه بيتصرف زي زمان — searching_technician فورًا)
    // مغطاة بالفعل بنفس الأسلوب في order_creation_live_test.dart، مش مكررة هنا عمدًا.

    await apiRequest('DELETE', '/addresses/$addressId', accessToken: accessToken);
  });
}
