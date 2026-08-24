import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  late final OrdersRepository _repository;
  List<Order>? _orders;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final orders = await _repository.list();
      if (mounted) setState(() => _orders = orders);
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
        appBar: AppBar(title: const Text('طلباتي')),
        body: _error != null
            ? Center(child: Text(_error!))
            : _orders == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : _orders!.isEmpty
                    ? const Center(
                        child: EmptyState(
                          icon: Icons.receipt_long_outlined,
                          title: 'لسه ماطلبتش أي حاجة',
                          description: 'أول ما تحجز خدمة، هتلاقي طلباتك هنا',
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _orders!.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final order = _orders![index];
                            return Card(
                              child: ListTile(
                                title: Text(order.orderNumber),
                                subtitle: Text(
                                  '${orderStatusLabelsAr[order.orderStatus] ?? order.orderStatus}'
                                  '${order.recurringTemplateId != null ? '\nحجز متكرر${order.recurringOccurrenceAt != null ? ' · ${order.recurringOccurrenceAt!.substring(0, 10)}' : ''}' : ''}',
                                ),
                                isThreeLine: order.recurringTemplateId != null,
                                trailing: Text(_formatEgp(order.totalAmountCents)),
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: order.id)),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
      ),
    );
  }
}
