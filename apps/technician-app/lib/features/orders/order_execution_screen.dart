import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'order.dart';
import 'orders_repository.dart';

class OrderExecutionScreen extends StatefulWidget {
  final Order initialOrder;

  const OrderExecutionScreen({super.key, required this.initialOrder});

  @override
  State<OrderExecutionScreen> createState() => _OrderExecutionScreenState();
}

class _OrderExecutionScreenState extends State<OrderExecutionScreen> {
  late final OrdersRepository _repository;
  late Order _order;
  bool _acting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _order = widget.initialOrder;
  }

  Future<void> _runAction(String action) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      switch (action) {
        case 'depart':
          _order = await _repository.depart(_order.id);
        case 'arrive':
          _order = await _repository.arrive(_order.id);
        case 'start':
          _order = await _repository.start(_order.id);
        case 'complete':
          _order = await _repository.complete(_order.id);
        case 'collect_cash':
          await _repository.collectCash(_order.id);
          // مفيش GET /technician/orders/:id — الطلب بعد collect-cash بيبقى completed دايماً
          // (نفس المسار الوحيد المتاح، مفيش دفع تاني في التطبيق لسه)، فبنعكسها محلياً.
          _order = Order(
            id: _order.id,
            orderNumber: _order.orderNumber,
            orderStatus: 'completed',
            problemDescription: _order.problemDescription,
            totalAmountCents: _order.totalAmountCents,
            paymentStatus: 'paid',
          );
      }
      if (mounted) setState(() {});
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final nextAction = nextTechnicianAction[_order.orderStatus];
    final isDone = _order.orderStatus == 'completed';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('طلب ${_order.orderNumber}')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      technicianOrderStatusLabelsAr[_order.orderStatus] ?? _order.orderStatus,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text('القيمة: ${_formatEgp(_order.totalAmountCents)}'),
                    if (_order.problemDescription != null) ...[
                      const SizedBox(height: 8),
                      Text('المشكلة: ${_order.problemDescription}'),
                    ],
                  ],
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 24),
            if (isDone)
              const Center(child: Text('الطلب اتقفل — شكراً على شغلك 👍'))
            else if (nextAction != null)
              FilledButton(
                onPressed: _acting ? null : () => _runAction(nextAction),
                child: _acting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(technicianActionLabelsAr[nextAction] ?? nextAction),
              ),
          ],
        ),
      ),
    );
  }
}
