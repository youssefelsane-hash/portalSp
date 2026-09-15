// اختبار حي حقيقي لدفع طلب من محفظة العميل ضد apps/api الشغال فعلاً — نفس أسلوب باقي test_live/.
// محتاج رصيد محفظة كافي مُجهّز مسبقاً (psql مباشر، موثّق في customer-app/README.md) لأنه مفيش
// endpoint API لشحن محفظة عميل تجريبي، وطلب حقيقي جاهز بحالة قابلة للدفع (work_completed/unpaid) —
// الاتنين محتاجين إعداد يدوي مباشر في القاعدة قبل تشغيل الاختبار ده، موثّق في تعليقات الكود.
// شغّله بـ: flutter test test_live/wallet_payment_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('عميل حقيقي يدفع طلب حقيقي من رصيد محفظته', () async {
    // **الاختبار بيجهّز شرطه بنفسه (تدقيق §148)**: قبل كده كان محتاج رصيد محفظة **وطلب في
    // حالة قابلة للدفع** متحضّرين بالإيد بـpsql من سيشن تانية — فبيسقط في أي قاعدة نضيفة على
    // «Expected: a value greater than <0>» اللي مش بيقول السبب. دلوقتي بيمشّي دورة تنفيذ
    // حقيقية لحد `work_completed` (من غير تحصيل كاش)، وبيشحن المحفظة زي ما الهارنس بتعمل.
    final accessToken = await registerCustomer(uniquePhone());
    final orderId = await completeOrderAwaitingPayment(accessToken, technicianPhone: '+201000000018', problemDescription: 'طلب اختبار الدفع من المحفظة');

    final orderBefore = await apiRequest('GET', '/orders/$orderId', accessToken: accessToken);
    final orderTotal = orderBefore!['total_amount_cents'] as int;
    await fundCustomerWallet(accessToken, orderTotal + 10000);

    final walletBefore = await apiRequest('GET', '/wallet', accessToken: accessToken);
    final balanceBefore = walletBefore!['balance_cents'] as int;
    expect(balanceBefore, greaterThan(0));

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
