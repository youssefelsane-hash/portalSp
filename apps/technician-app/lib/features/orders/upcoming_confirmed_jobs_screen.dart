import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'order.dart';
import 'order_execution_screen.dart';
import 'orders_repository.dart';

// "الشغل المؤكّد قدامي" (docs/08 §165، بعد ADR-0017) — كانت فجوة حقيقية: طلبات مجدولة مستقبلية
// بتتأكّد تلقائيًا (autoConfirmFutureOrder() في الباك-إند، مفيش قرار قبول/رفض من الفني خالص —
// عكس الطلبات القريبة اللي في AvailableOrdersScreen) بس مفيش شاشة في التطبيق كانت بتعرضها للفني
// قبل ما يوم تنفيذها يوصل. الفني كان معندوش أي طريقة يشوف "إيه المؤكّد قدامي" أصلاً.
class UpcomingConfirmedJobsScreen extends StatefulWidget {
  const UpcomingConfirmedJobsScreen({super.key});

  @override
  State<UpcomingConfirmedJobsScreen> createState() => _UpcomingConfirmedJobsScreenState();
}

class _UpcomingConfirmedJobsScreenState extends State<UpcomingConfirmedJobsScreen> {
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
      final orders = await _repository.fetchUpcomingConfirmed();
      if (mounted) setState(() => _orders = orders);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatScheduledAt(String? iso) {
    if (iso == null) return '';
    final at = DateTime.parse(iso).toLocal();
    final two = (int n) => n.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)}/${at.year} الساعة ${two(at.hour)}:${two(at.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الشغل المؤكّد قدامي')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _orders == null
              ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
              : _orders!.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: 60),
                    EmptyState(
                      icon: Icons.event_available_outlined,
                      title: 'مفيش شغل مؤكّد مجدول قدامك دلوقتي',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _orders!.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final order = _orders![index];
                    return Card(
                      child: ListTile(
                        leading: const Icon(Icons.event_available_outlined),
                        title: Text('طلب ${order.orderNumber}'),
                        subtitle: Text(
                          '${_formatScheduledAt(order.scheduledAt)}'
                          '${order.address != null ? ' — ${order.address!.streetName}' : ''}',
                        ),
                        trailing: const Icon(Icons.chevron_left),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)),
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
