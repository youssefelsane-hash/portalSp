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
}
