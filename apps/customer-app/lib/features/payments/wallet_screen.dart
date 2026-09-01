import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/app_theme.dart';
import 'payments_repository.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  WalletBalance? _wallet;
  List<WalletTransactionItem> _transactions = const [];
  String? _error;
  bool _loading = true;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = PaymentsRepository(context.read<AuthRepository>());
      final results = await Future.wait<Object>([
        repository.fetchWallet(),
        repository.fetchWalletTransactions(),
      ]);
      if (!mounted) return;
      setState(() {
        _wallet = results[0] as WalletBalance;
        _transactions = results[1] as List<WalletTransactionItem>;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذّر تحميل المحفظة، حاول تاني');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('محفظتي')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: [
              _WalletBalanceCard(wallet: _wallet, loading: _loading),
              const SizedBox(height: AppSpacing.md),
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: Theme.of(
                    context,
                  ).colorScheme.primaryContainer.withValues(alpha: 0.45),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline_rounded),
                    SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        'أي مبلغ مسترجع بيتضاف هنا تلقائيًا، وتقدر تستخدم الرصيد في دفع طلباتك الجاية.',
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                'سجل الحركات',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: AppSpacing.md),
              if (_error != null)
                _WalletError(message: _error!, onRetry: _load)
              else if (_loading && _wallet == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_transactions.isEmpty)
                const _EmptyTransactions()
              else
                ..._transactions.map(
                  (transaction) => _TransactionTile(transaction: transaction),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WalletBalanceCard extends StatelessWidget {
  final WalletBalance? wallet;
  final bool loading;

  const _WalletBalanceCard({required this.wallet, required this.loading});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            scheme.primary,
            Color.lerp(scheme.primary, Colors.black, 0.28)!,
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: scheme.primary.withValues(alpha: 0.22),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.account_balance_wallet_rounded, color: Colors.white),
              SizedBox(width: AppSpacing.sm),
              Text(
                'الرصيد المتاح',
                style: TextStyle(color: Colors.white70, fontSize: 16),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          if (loading && wallet == null)
            const SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                color: Colors.white,
                strokeWidth: 2.5,
              ),
            )
          else
            Text(
              formatWalletAmount(wallet?.balanceCents ?? 0),
              textDirection: TextDirection.rtl,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 34,
                fontWeight: FontWeight.w800,
              ),
            ),
          if ((wallet?.pendingBalanceCents ?? 0) > 0) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              '${formatWalletAmount(wallet!.pendingBalanceCents)} قيد المعالجة',
              style: const TextStyle(color: Colors.white70),
            ),
          ],
          if (wallet?.isFrozen ?? false) ...[
            const SizedBox(height: AppSpacing.md),
            const Text(
              'المحفظة موقوفة مؤقتًا، تواصل مع الدعم.',
              style: TextStyle(color: Colors.white),
            ),
          ],
        ],
      ),
    );
  }
}

class _TransactionTile extends StatelessWidget {
  final WalletTransactionItem transaction;

  const _TransactionTile({required this.transaction});

  @override
  Widget build(BuildContext context) {
    final color = transaction.isReversed
        ? Theme.of(context).colorScheme.outline
        : transaction.isCredit
        ? context.successColor
        : Theme.of(context).colorScheme.error;
    return Card(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.12),
          foregroundColor: color,
          child: Icon(_transactionIcon(transaction.transactionType)),
        ),
        title: Text(
          transaction.descriptionAr?.trim().isNotEmpty == true
              ? transaction.descriptionAr!.trim()
              : walletTransactionLabel(transaction.transactionType),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${formatWalletDate(transaction.createdAt)} • الرصيد بعدها ${formatWalletAmount(transaction.balanceAfterCents)}',
        ),
        trailing: Text(
          '${transaction.isCredit ? '+' : '-'}${formatWalletAmount(transaction.amountCents)}',
          textDirection: TextDirection.rtl,
          style: TextStyle(color: color, fontWeight: FontWeight.w800),
        ),
      ),
    );
  }
}

class _WalletError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _WalletError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      children: [
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        TextButton(onPressed: onRetry, child: const Text('حاول تاني')),
      ],
    ),
  );
}

class _EmptyTransactions extends StatelessWidget {
  const _EmptyTransactions();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(
      vertical: 40,
      horizontal: AppSpacing.lg,
    ),
    decoration: BoxDecoration(
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(16),
    ),
    child: const Column(
      children: [
        Icon(Icons.receipt_long_outlined, size: 36),
        SizedBox(height: AppSpacing.sm),
        Text('مفيش حركات في المحفظة لسه'),
      ],
    ),
  );
}

String formatWalletAmount(int cents) =>
    '${(cents / 100).toStringAsFixed(2)} ج.م.';

String formatWalletDate(DateTime value) {
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}/${two(value.month)}/${two(value.day)}  ${two(value.hour)}:${two(value.minute)}';
}

String walletTransactionLabel(String type) => switch (type) {
  'refund' => 'استرجاع مبلغ',
  'topup' => 'شحن المحفظة',
  'bonus' => 'مكافأة',
  'referral_reward' => 'مكافأة ترشيح',
  'adjustment' => 'تسوية رصيد',
  'withdrawal' => 'سحب من المحفظة',
  'installment_collection' => 'دفع قسط',
  _ => 'حركة محفظة',
};

IconData _transactionIcon(String type) => switch (type) {
  'refund' => Icons.replay_rounded,
  'topup' => Icons.add_card_rounded,
  'bonus' || 'referral_reward' => Icons.redeem_rounded,
  'withdrawal' => Icons.south_west_rounded,
  _ => Icons.swap_horiz_rounded,
};
