import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'earnings_repository.dart';
import 'models.dart';

class PayoutsScreen extends StatefulWidget {
  final EarningsRepository repository;

  const PayoutsScreen({super.key, required this.repository});

  @override
  State<PayoutsScreen> createState() => _PayoutsScreenState();
}

class _PayoutsScreenState extends State<PayoutsScreen> {
  List<Payout>? _payouts;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final payouts = await widget.repository.fetchPayouts();
      if (mounted) setState(() => _payouts = payouts);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('طلبات الصرف')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _payouts == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : _payouts!.isEmpty
                    ? const Center(child: EmptyState(icon: Icons.receipt_long_outlined, title: 'لسه ماطلبتش أي صرف'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _payouts!.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final payout = _payouts![index];
                            return Card(
                              child: ListTile(
                                title: Text(payout.payoutNumber),
                                subtitle: Text(
                                  '${payoutStatusLabelsAr[payout.payoutStatus] ?? payout.payoutStatus} — ${payoutMethodLabelsAr[payout.payoutMethod] ?? payout.payoutMethod}',
                                ),
                                trailing: Text(_formatEgp(payout.netAmountCents)),
                              ),
                            );
                          },
                        ),
                      ),
      ),
    );
  }
}
