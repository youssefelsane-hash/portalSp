// اختبار حي حقيقي لمحفظة الفني وطلب الصرف ضد apps/api الشغال فعلاً — نفس أسلوب باقي test_live/.
// شغّله بـ: flutter test test_live/earnings_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';

// مسار اللوج بيتحدد وقت التشغيل (`_live_support.dart`) — كان مكتوب بالإيد لسيشن قديمة فمات معاها.
Future<String> _latestOtpFor(String phoneNumber) => latestOtpFor(phoneNumber);

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
  test('فني حقيقي يشوف محفظته الحقيقية ويطلب صرف حقيقي', () async {
    final accessToken = await _loginAs('+201000000011');

    final wallet = await apiRequest('GET', '/wallet', accessToken: accessToken);
    expect(wallet, isNotNull);
    final balanceBefore = wallet!['balance_cents'] as int;
    expect(balanceBefore, greaterThan(0), reason: 'الفني ده حصّل كاش قبل كده في اختبار حي تاني، لازم يكون له رصيد');

    final transactions = await apiRequestList('/wallet/transactions', accessToken: accessToken);
    expect(transactions, isNotEmpty);

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
