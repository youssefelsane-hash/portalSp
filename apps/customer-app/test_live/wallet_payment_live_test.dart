// اختبار حي حقيقي لدفع طلب من محفظة العميل ضد apps/api الشغال فعلاً — نفس أسلوب باقي test_live/.
// محتاج رصيد محفظة كافي مُجهّز مسبقاً (psql مباشر، موثّق في customer-app/README.md) لأنه مفيش
// endpoint API لشحن محفظة عميل تجريبي، وطلب حقيقي جاهز بحالة قابلة للدفع (work_completed/unpaid) —
// الاتنين محتاجين إعداد يدوي مباشر في القاعدة قبل تشغيل الاختبار ده، موثّق في تعليقات الكود.
// شغّله بـ: flutter test test_live/wallet_payment_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';

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
  test('عميل حقيقي يدفع طلب حقيقي من رصيد محفظته', () async {
    final accessToken = await _loginAs('+201000009999');

    final walletBefore = await apiRequest('GET', '/wallet', accessToken: accessToken);
    final balanceBefore = walletBefore!['balance_cents'] as int;
    expect(balanceBefore, greaterThan(0), reason: 'محتاج رصيد محفظة مُجهّز مسبقاً — راجع تعليق أعلى الملف');

    // بندوّر على أول طلب work_completed/awaiting_payment مش مدفوع بعد لنفس العميل — مفيش
    // endpoint لإنشاء طلب في الحالة دي مباشرة (لازم يعدّي دورة الفني كاملة)، فالطلب التجريبي
    // ده اتحضّر مسبقاً بـ psql مباشر (موثّق في README).
    final orders = await apiRequestList('/orders', accessToken: accessToken);
    final payableOrder = orders.firstWhere(
      (o) => (o['order_status'] == 'work_completed' || o['order_status'] == 'awaiting_payment') &&
          o['payment_status'] != 'paid',
      orElse: () => throw StateError('مفيش طلب قابل للدفع — جهّزه الأول بـ psql'),
    );
    final orderId = payableOrder['id'] as String;
    final orderTotal = payableOrder['total_amount_cents'] as int;

    final payment = await apiRequest(
      'POST',
      '/orders/$orderId/pay-with-wallet',
      accessToken: accessToken,
      extraHeaders: {'Idempotency-Key': 'live-test-${DateTime.now().microsecondsSinceEpoch}'},
    );
    expect(payment, isNotNull);
    expect(payment!['payment_method'], 'wallet');
    expect(payment['payment_status'], 'succeeded');
    expect(payment['amount_cents'], orderTotal);

    final orderAfter = await apiRequest('GET', '/orders/$orderId', accessToken: accessToken);
    expect(orderAfter!['order_status'], 'completed');
    expect(orderAfter['payment_status'], 'paid');

    final walletAfter = await apiRequest('GET', '/wallet', accessToken: accessToken);
    expect(walletAfter!['balance_cents'], balanceBefore - orderTotal);
  });
}
