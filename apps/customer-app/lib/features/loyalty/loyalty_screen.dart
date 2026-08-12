import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'loyalty_repository.dart';
import 'models.dart';

// نقاط الولاء (docs/08) — كانت فجوة موثّقة صراحة: GET/POST /loyalty/* كانت شغالة ومختبرة في
// الباك-إند من زمان بس مفيش شاشة في التطبيق كانت بتستخدمها — العميل مكانش يقدر يشوف رصيده
// ولا يستبدل نقاطه خالص.
class LoyaltyScreen extends StatefulWidget {
  const LoyaltyScreen({super.key});

  @override
  State<LoyaltyScreen> createState() => _LoyaltyScreenState();
}

class _LoyaltyScreenState extends State<LoyaltyScreen> {
  late final LoyaltyRepository _repository;
  int? _balance;
  List<LoyaltyTransaction>? _transactions;
  String? _error;
  bool _redeeming = false;

  @override
  void initState() {
    super.initState();
    _repository = LoyaltyRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repository.fetchBalance(), _repository.fetchTransactions()]);
      if (mounted) {
        setState(() {
          _balance = results[0] as int;
          _transactions = results[1] as List<LoyaltyTransaction>;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _openRedeemDialog() async {
    final controller = TextEditingController();
    final points = await showDialog<int>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('استبدال نقاط'),
          content: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: 'عدد النقاط', helperText: 'رصيدك الحالي: ${_balance ?? 0}'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(int.tryParse(controller.text.trim())),
              child: const Text('استبدال'),
            ),
          ],
        ),
      ),
    );
    if (points == null || points <= 0) return;
    setState(() {
      _redeeming = true;
      _error = null;
    });
    try {
      await _repository.redeem(points);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _redeeming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('نقاط الولاء')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _balance == null
              ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            Text('رصيدك', style: Theme.of(context).textTheme.titleMedium),
                            const SizedBox(height: 8),
                            Text('$_balance نقطة', style: Theme.of(context).textTheme.headlineMedium),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: _redeeming ? null : _openRedeemDialog,
                              icon: const Icon(Icons.redeem_outlined),
                              label: const Text('استبدال نقاط'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 16),
                    Text('سجل المعاملات', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (_transactions == null || _transactions!.isEmpty) const Text('مفيش معاملات لسه'),
                    for (final tx in _transactions ?? <LoyaltyTransaction>[])
                      Card(
                        child: ListTile(
                          leading: Icon(
                            tx.direction == 'earn'
                                ? Icons.add_circle_outline
                                : tx.direction == 'redeem'
                                    ? Icons.remove_circle_outline
                                    : Icons.timer_off_outlined,
                            color: tx.direction == 'earn' ? Colors.green : Colors.red,
                          ),
                          title: Text(
                            '${loyaltyDirectionLabelsAr[tx.direction] ?? tx.direction} — ${tx.pointsAmount} نقطة',
                          ),
                          subtitle: Text(
                            '${loyaltySourceLabelsAr[tx.source] ?? tx.source} — ${tx.createdAt.substring(0, 10)}',
                          ),
                          trailing: Text('الرصيد: ${tx.balanceAfter}'),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}
