// اختبار حي حقيقي لتقييم طلب مكتمل ضد apps/api الشغال فعلاً — نفس أسلوب باقي test_live/.
// شغّله بـ: flutter test test_live/rating_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _loginAs(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('عميل حقيقي يقيّم طلب مكتمل حقيقي، وتاني محاولة ترفض 409 واضح', () async {
    final accessToken = await _loginAs('+201000009999');

    // لازم نلاقي طلب completed حقيقي بتاع نفس العميل ده لسه مش مُقيَّم — بندوّر جوّه القايمة
    // بدل ما نفترض id ثابت، عشان الاختبار يفضل شغال حتى لو بيانات القاعدة اتغيّرت.
    final orders = await apiRequestList('/orders', accessToken: accessToken);
    final completedOrders = orders.where((o) => o['order_status'] == 'completed').toList();
    expect(completedOrders, isNotEmpty, reason: 'محتاجين طلب completed واحد على الأقل لنفس العميل عشان نختبر التقييم');

    String? ratableOrderId;
    for (final order in completedOrders) {
      try {
        final rating = await apiRequest(
          'POST',
          '/orders/${order['id']}/rate',
          accessToken: accessToken,
          body: {'overall_rating': 5, 'comment': 'اختبار حي — شكراً على الشغل'},
        );
        expect(rating!['overall_rating'], 5);
        expect(rating['rating_type'], 'customer_to_technician');
        ratableOrderId = order['id'] as String;
        break;
      } on ApiException catch (err) {
        // الطلب ده اتقيّم قبل كده (409) — جرّب اللي بعده
        if (err.statusCode != 409) rethrow;
      }
    }
    expect(ratableOrderId, isNotNull, reason: 'كل الطلبات المكتملة كانت متقيّمة قبل كده — مش متوقع');

    // محاولة تانية لنفس الطلب لازم ترفض 409 بوضوح
    ApiException? secondAttemptError;
    try {
      await apiRequest(
        'POST',
        '/orders/$ratableOrderId/rate',
        accessToken: accessToken,
        body: {'overall_rating': 4},
      );
    } on ApiException catch (err) {
      secondAttemptError = err;
    }
    expect(secondAttemptError, isNotNull);
    expect(secondAttemptError!.statusCode, 409);
  });
}
