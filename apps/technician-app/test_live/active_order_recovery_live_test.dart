// اختبار حي حقيقي لـ GET /technician/orders/active (كانت فجوة موثّقة، اتقفلت) — استرجاع "الطلب
// النشط الحالي" للفني من غير ما يعرف الـ id مقدماً، عشان الشاشة الرئيسية تقدر ترجّعه تلقائياً
// لشاشة التنفيذ لو التطبيق اتقفل في نص الدورة. نفس أسلوب order_execution_live_test.dart بالظبط.
// شغّله بـ: flutter test test_live/active_order_recovery_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_exception.dart';

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
  test('الفني يسترجع الطلب النشط الحالي في كل مرحلة من دورة التنفيذ', () async {
    final customerToken = await _loginAs('+201000009999');
    final technicianToken = await _loginAs('+201000000011');

    // قبل أي طلب جديد — ممكن يكون فيه طلب نشط قديم من اختبار تاني، فبنقفله الأول عشان
    // الاختبار ده يبدأ من حالة معروفة (null فعلاً).
    final preExisting = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    if (preExisting != null) {
      final leftoverId = preExisting['id'] as String;
      final status = preExisting['order_status'] as String;
      final steps = ['accepted', 'technician_on_way', 'technician_arrived', 'in_progress'];
      for (final step in steps.skip(steps.indexOf(status))) {
        final action = {
          'accepted': 'depart',
          'technician_on_way': 'arrive',
          'technician_arrived': 'start',
          'in_progress': 'complete',
        }[step]!;
        await apiRequest('POST', '/technician/orders/$leftoverId/$action', accessToken: technicianToken);
      }
      await apiRequest('POST', '/technician/orders/$leftoverId/collect-cash', accessToken: technicianToken);
    }

    final noneActive = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(noneActive, isNull);

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
        'problem_description': 'اختبار حي لاسترجاع الطلب النشط',
      },
    );
    final orderId = order!['id'] as String;

    await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);
    final afterAccept = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterAccept!['id'], orderId);
    expect(afterAccept['order_status'], 'accepted');

    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    final afterDepart = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterDepart!['id'], orderId);
    expect(afterDepart['order_status'], 'technician_on_way');

    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    final afterStart = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterStart!['order_status'], 'in_progress');

    await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/collect-cash', accessToken: technicianToken);

    final afterCompletion = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterCompletion, isNull, reason: 'الطلب خلص، مفيش داعي يرجّع أي حاجة كـ"نشطة" تاني');

    // عميل مش فني — لازم يترفض 403
    await expectLater(
      apiRequest('GET', '/technician/orders/active', accessToken: customerToken),
      throwsA(isA<ApiException>()),
    );
  });
}
