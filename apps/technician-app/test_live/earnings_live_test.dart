// اختبار حي حقيقي لمحفظة الفني وطلب الصرف ضد apps/api الشغال فعلاً — نفس أسلوب باقي test_live/.
// شغّله بـ: flutter test test_live/earnings_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('فني حقيقي يشوف محفظته الحقيقية ويطلب صرف حقيقي', () async {
    // **الاختبار بيجهّز شرطه بنفسه (تدقيق §148)**: كان معتمد على إن «الفني ده حصّل كاش قبل كده
    // في اختبار حي تاني» — اعتماد على ترتيب تشغيل اختبارات تانية، فبيسقط في أي قاعدة نضيفة.
    final accessToken = await devTechnicianToken('+201000000041');
    await fundTechnicianWallet(accessToken, 50000);

    final wallet = await apiRequest('GET', '/wallet', accessToken: accessToken);
    expect(wallet, isNotNull);
    final balanceBefore = wallet!['balance_cents'] as int;
    expect(balanceBefore, greaterThan(0));

    final payoutsBefore = await apiRequestList('/technician/payouts', accessToken: accessToken);

    final payout = await apiRequest(
      'POST',
      '/technician/payouts',
      accessToken: accessToken,
      body: {
        'amount_cents': 20000,
        'payout_method': 'vodafone_cash',
        'destination_masked': '01xxxxxx999',
      },
    );
    expect(payout, isNotNull);
    expect(payout!['amount_cents'], 20000);
    expect(['approved', 'under_review'], contains(payout['payout_status']));

    final payoutsAfter = await apiRequestList('/technician/payouts', accessToken: accessToken);
    expect(payoutsAfter.length, payoutsBefore.length + 1);
    expect(payoutsAfter.any((p) => p['id'] == payout['id']), isTrue);
  });
}
