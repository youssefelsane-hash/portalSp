import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/app_motion.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';
import '../../design/status_chip.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  late final OrdersRepository _repository;
  List<Order>? _orders;
  String? _nextCursor;
  bool _loadingMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await _repository.list();
      if (mounted) setState(() {
        _orders = page.items;
        _nextCursor = page.nextCursor;
      });
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _nextCursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await _repository.list(cursor: _nextCursor);
      if (mounted) setState(() {
        _orders = [...?_orders, ...page.items];
        _nextCursor = page.nextCursor;
      });
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
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
                  itemCount: _orders!.length + (_nextCursor == null ? 0 : 1),
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    if (index == _orders!.length) {
                      return Center(
                        child: TextButton(
                          onPressed: _loadingMore ? null : _loadMore,
                          child: Text(_loadingMore ? 'بيتم تحميل طلبات أقدم...' : 'عرض طلبات أقدم'),
                        ),
                      );
                    }
                    final order = _orders![index];
                    // docs/08 §122 — دخول متدرّج خفيف بعد التحميل: بيوضّح إن دي قايمة
                    // وصلت دلوقتي، بدل ما تظهر دفعة واحدة فجأة. التدرّج بيقف عند
                    // العنصر الثامن (motionListDelay) عشان مايتحوّلش لانتظار.
                    return MotionReveal(
                      delay: motionListDelay(index),
                      child: Card(
                        child: ListTile(
                          title: Text(order.orderNumber),
                          // الحالة كـ«شريحة» ملوّنة زي تطبيق الفني بالظبط، مش نص رمادي
                          // وسط باقي السطر (docs/08 §131): «مستني موافقتك على السعر»
                          // و«اتلغى» كانوا بيتعرضوا بنفس الشكل تمامًا.
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const SizedBox(height: 4),
                              Align(
                                alignment: AlignmentDirectional.centerStart,
                                child: StatusChip(
                                  label:
                                      orderStatusLabelsAr[order.orderStatus] ??
                                      order.orderStatus,
                                  tone: orderStatusTone(order.orderStatus),
                                ),
                              ),
                              if (order.recurringTemplateId != null)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(
                                    'حجز متكرر${order.recurringOccurrenceAt != null ? ' · ${order.recurringOccurrenceAt!.substring(0, 10)}' : ''}',
                                  ),
                                ),
                            ],
                          ),
                          isThreeLine: order.recurringTemplateId != null,
                          trailing: Text(_formatEgp(order.totalAmountCents)),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  OrderDetailScreen(orderId: order.id),
                            ),
                          ),
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
