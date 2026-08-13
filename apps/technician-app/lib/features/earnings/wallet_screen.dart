import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import 'earnings_repository.dart';
import 'models.dart';
import 'payout_request_screen.dart';
import 'payouts_screen.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  late final EarningsRepository _repository;
  Wallet? _wallet;
  List<WalletTransaction>? _transactions;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = EarningsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repository.fetchWallet(), _repository.fetchTransactions()]);
      if (mounted) {
        setState(() {
          _wallet = results[0] as Wallet;
          _transactions = results[1] as List<WalletTransaction>;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _requestPayout() async {
    final wallet = _wallet;
    if (wallet == null) return;
    final created = await Navigator.of(context).push<Payout>(
      MaterialPageRoute(
        builder: (_) => PayoutRequestScreen(repository: _repository, availableBalanceCents: wallet.balanceCents),
      ),
    );
    if (created != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('طلب الصرف ${created.payoutNumber} اترسل')),
      );
      await _load();
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final wallet = _wallet;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('أرباحي'),
          actions: [
            IconButton(
              icon: const Icon(Icons.receipt_long),
              tooltip: 'طلبات الصرف',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => PayoutsScreen(repository: _repository)),
              ),
            ),
          ],
        ),
        body: _error != null
            ? Center(child: Text(_error!))
            : wallet == null
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Column(
                              children: [
                                Text('الرصيد المتاح', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 8),
                                Text(
                                  _formatEgp(wallet.balanceCents),
                                  style: Theme.of(context).textTheme.headlineMedium,
                                ),
                                const SizedBox(height: 16),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                                  children: [
                                    Column(
                                      children: [
                                        Text('إجمالي الأرباح'),
                                        Text(_formatEgp(wallet.totalEarnedCents)),
                                      ],
                                    ),
                                    Column(
                                      children: [
                                        const Text('إجمالي المسحوب'),
                                        Text(_formatEgp(wallet.totalWithdrawnCents)),
                                      ],
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: wallet.isFrozen ? null : _requestPayout,
                          child: Text(wallet.isFrozen ? 'المحفظة مجمّدة' : 'اطلب صرف'),
                        ),
                        const SizedBox(height: 24),
                        Text('آخر الحركات', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        if (_transactions == null || _transactions!.isEmpty)
                          const EmptyState(icon: Icons.receipt_long_outlined, title: 'مفيش حركات لسه')
                        else
                          ...(_transactions!.map(
                            (tx) => Card(
                              child: ListTile(
                                title: Text(tx.descriptionAr ?? tx.transactionType),
                                subtitle: Text(tx.createdAt.split('T').first),
                                trailing: Text(
                                  '${tx.direction == 'credit' ? '+' : '-'}${_formatEgp(tx.amountCents)}',
                                  style: TextStyle(
                                    color: tx.direction == 'credit' ? Colors.green : Colors.red,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                          )),
                      ],
                    ),
                  ),
      ),
    );
  }
}
