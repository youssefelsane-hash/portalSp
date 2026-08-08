import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../ratings/rating_dialog.dart';
import '../ratings/ratings_repository.dart';
import 'models.dart';
import 'orders_repository.dart';

class OrderDetailScreen extends StatefulWidget {
  final String orderId;

  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late final OrdersRepository _repository;
  late final RatingsRepository _ratingsRepository;
  Order? _order;
  String? _error;
  bool _cancelling = false;
  bool _rated = false;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = OrdersRepository(auth);
    _ratingsRepository = RatingsRepository(auth);
    _load();
  }

  Future<void> _load() async {
    try {
      final order = await _repository.getOne(widget.orderId);
      if (mounted) setState(() => _order = order);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _cancel() async {
    setState(() => _cancelling = true);
    try {
      final order = await _repository.cancel(widget.orderId);
      if (mounted) setState(() => _order = order);
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  Future<void> _rate() async {
    final result = await showRatingDialog(context);
    if (result == null) return;
    try {
      await _ratingsRepository.rate(widget.orderId, overallRating: result.overallRating, comment: result.comment);
      if (mounted) {
        setState(() => _rated = true);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('شكراً على تقييمك 🙏')));
      }
    } on ApiException catch (err) {
      // 409 لو اتقيّم قبل كده (مفيش endpoint تحقق مسبق، راجع ratings_repository.dart) —
      // بنعتبرها نفس نتيجة "اتقيّم" من ناحية الواجهة، مش خطأ حقيقي محتاج المستخدم يعيد المحاولة.
      if (mounted) {
        if (err.statusCode == 409) {
          setState(() => _rated = true);
        }
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(order != null ? 'طلب ${order.orderNumber}' : 'تفاصيل الطلب')),
        body: _error != null
            ? Center(child: Text(_error!))
            : order == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                orderStatusLabelsAr[order.orderStatus] ?? order.orderStatus,
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 8),
                              Text('السعر الإجمالي: ${_formatEgp(order.totalAmountCents)}'),
                              if (order.problemDescription != null) ...[
                                const SizedBox(height: 8),
                                Text('الوصف: ${order.problemDescription}'),
                              ],
                            ],
                          ),
                        ),
                      ),
                      if (customerCancellableStatuses.contains(order.orderStatus)) ...[
                        const SizedBox(height: 16),
                        OutlinedButton(
                          onPressed: _cancelling ? null : _cancel,
                          child: _cancelling
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('إلغاء الطلب'),
                        ),
                      ],
                      if (order.orderStatus == 'completed' && !_rated) ...[
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _rate,
                          icon: const Icon(Icons.star_outline),
                          label: const Text('قيّم الطلب'),
                        ),
                      ],
                    ],
                  ),
      ),
    );
  }
}
