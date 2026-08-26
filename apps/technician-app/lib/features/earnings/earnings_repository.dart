import '../../core/auth_repository.dart';
import 'models.dart';

class EarningsRepository {
  final AuthRepository auth;

  EarningsRepository(this.auth);

  Future<Wallet> fetchWallet() async {
    final data = await auth.authedRequest('GET', '/wallet');
    return Wallet.fromJson(data!);
  }

  Future<List<WalletTransaction>> fetchTransactions() async {
    final items = await auth.authedRequestList('/wallet/transactions');
    return items.map(WalletTransaction.fromJson).toList();
  }

  Future<List<Payout>> fetchPayouts() async {
    final items = await auth.authedRequestList('/technician/payouts');
    return items.map(Payout.fromJson).toList();
  }

  Future<Payout> requestPayout({
    required int amountCents,
    required String payoutMethod,
    String? destinationMasked,
  }) async {
    final data = await auth.authedRequest('POST', '/technician/payouts', body: {
      'amount_cents': amountCents,
      'payout_method': payoutMethod,
      if (destinationMasked != null && destinationMasked.isNotEmpty) 'destination_masked': destinationMasked,
    });
    return Payout.fromJson(data!);
  }

  /// كشف مستحقات الشهر (docs/08 §61.1). من غير `month` السيرفر بيرجّع الشهر الحالي.
  Future<MonthlyStatement> fetchMonthlyStatement({String? month}) async {
    final path = month == null ? '/technician/earnings/statement' : '/technician/earnings/statement?month=$month';
    final data = await auth.authedRequest('GET', path);
    return MonthlyStatement.fromJson(data!);
  }

  /// الشهور اللي فيها شغل مقفول (الأحدث الأول) — لمنتقي الشهر.
  Future<List<String>> fetchAvailableMonths() async {
    final data = await auth.authedRequest('GET', '/technician/earnings/months');
    return ((data?['months'] as List<dynamic>?) ?? []).map((m) => m as String).toList();
  }
}
