import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'order_execution_screen.dart';
import 'orders_repository.dart';

class AvailableOrdersScreen extends StatefulWidget {
  const AvailableOrdersScreen({super.key});

  @override
  State<AvailableOrdersScreen> createState() => _AvailableOrdersScreenState();
}

class _AvailableOrdersScreenState extends State<AvailableOrdersScreen> {
  late final OrdersRepository _repository;
  List<AvailableOrder>? _orders;
  String? _error;
  bool _isActing = false;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final orders = await _repository.fetchAvailable();
      if (mounted) setState(() => _orders = orders);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _accept(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      final acceptedOrder = await _repository.accept(order.orderId);
      if (mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: acceptedOrder)),
        );
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  Future<void> _reject(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      await _repository.reject(order.orderId);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('baytak — الفني'),
          actions: [
            IconButton(icon: const Icon(Icons.logout), onPressed: () => context.read<AuthRepository>().logout()),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _orders == null
                  ? const Center(child: CircularProgressIndicator())
                  : _orders!.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 120),
                            Center(child: Text('أهلاً ${auth.user?.fullName ?? ''} 👋')),
                            const SizedBox(height: 12),
                            const Center(child: Text('مفيش طلبات متاحة دلوقتي')),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _orders!.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final order = _orders![index];
                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(order.serviceNameAr, style: Theme.of(context).textTheme.titleMedium),
                                    const SizedBox(height: 4),
                                    Text('${order.streetName}${order.landmark != null ? ' — ${order.landmark}' : ''}'),
                                    Text('على بعد ${order.distanceKm.toStringAsFixed(1)} كم'),
                                    if (order.problemDescription != null) Text(order.problemDescription!),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        FilledButton(
                                          onPressed: _isActing ? null : () => _accept(order),
                                          child: const Text('قبول'),
                                        ),
                                        const SizedBox(width: 8),
                                        OutlinedButton(
                                          onPressed: _isActing ? null : () => _reject(order),
                                          child: const Text('رفض'),
                                        ),
                                      ],
                                    ),
                                  ],
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
