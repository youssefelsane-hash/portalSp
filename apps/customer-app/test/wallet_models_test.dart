import 'package:customer_app/features/payments/payments_repository.dart';
import 'package:customer_app/features/payments/wallet_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('wallet parses the available and pending refund balances', () {
    final wallet = WalletBalance.fromJson({
      'balance_cents': 12550,
      'pending_balance_cents': 3000,
      'reserved_balance_cents': 0,
      'currency_code': 'EGP',
      'is_frozen': false,
    });

    expect(wallet.balanceCents, 12550);
    expect(wallet.pendingBalanceCents, 3000);
    expect(formatWalletAmount(wallet.balanceCents), '125.50 ج.م.');
  });

  test('refund transaction stays visibly identified as a credit', () {
    final transaction = WalletTransactionItem.fromJson({
      'id': 'refund-tx',
      'direction': 'credit',
      'transaction_type': 'refund',
      'amount_cents': 8800,
      'balance_after_cents': 12800,
      'description_ar': 'استرجاع للطلب ORD-1',
      'is_reversed': false,
      'created_at': '2026-08-29T12:00:00.000Z',
    });

    expect(transaction.isCredit, isTrue);
    expect(transaction.amountCents, 8800);
    expect(walletTransactionLabel(transaction.transactionType), 'استرجاع مبلغ');
  });
}
