import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../chat/chat_screen.dart';
import '../payments/payments_repository.dart';
import '../ratings/rating_dialog.dart';
import '../ratings/ratings_repository.dart';
import '../tracking/tracking_screen.dart';
import 'models.dart';
import 'orders_repository.dart';

// نفس PAYABLE_ORDER_STATUSES في payments.service.ts بالظبط.
const Set<String> _payableOrderStatuses = {'work_completed', 'awaiting_payment'};

// نفس ACTIVE_TRACKING_STATUSES في order-tracking.gateway.ts بالظبط.
const Set<String> _activeTrackingStatuses = {'accepted', 'technician_on_way', 'technician_arrived', 'in_progress'};

class OrderDetailScreen extends StatefulWidget {
  final String orderId;

  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late final OrdersRepository _repository;
  late final RatingsRepository _ratingsRepository;
  late final PaymentsRepository _paymentsRepository;
  Order? _order;
  String? _error;
  bool _cancelling = false;
  bool _rated = false;
  bool _paying = false;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = OrdersRepository(auth);
    _ratingsRepository = RatingsRepository(auth);
    _paymentsRepository = PaymentsRepository(auth);
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
    final result = await _showCancelDialog();
    if (result == null) return; // العميل قفل الـ dialog من غير ما يأكّد

    setState(() => _cancelling = true);
    try {
      final order = await _repository.cancel(
        widget.orderId,
        reason: result.freeText,
        cancellationReasonId: result.reasonId,
      );
      if (mounted) {
        setState(() => _order = order);
        final feeMessage = order.cancellationFeeCents > 0
            ? ' — اترصدت عليك رسوم إلغاء ${_formatEgp(order.cancellationFeeCents)}'
            : '';
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('اتلغى الطلب$feeMessage')));
      }
    } on ApiException catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  // كانت فجوة موثّقة: الإلغاء مكانش بياخد سبب خالص من الواجهة رغم إن الباك-إند بيدعمه
  // (GET /cancellation-reasons + احتساب رسوم حسب النافذة الزمنية) — اتقفلت هنا.
  Future<_CancelChoice?> _showCancelDialog() async {
    List<CancellationReason> reasons = [];
    try {
      reasons = await _repository.listCancellationReasons();
    } on ApiException {
      // فشل تحميل الأسباب مش لازم يمنع الإلغاء نفسه — العميل لسه يقدر يلغي بسبب حر
    }

    String? selectedReasonId;
    final freeTextController = TextEditingController();

    if (!mounted) return null;
    return showDialog<_CancelChoice>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: const Text('إلغاء الطلب'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (reasons.isNotEmpty) ...[
                    const Text('اختار سبب الإلغاء:'),
                    ...reasons.map(
                      (r) => RadioListTile<String>(
                        value: r.id,
                        groupValue: selectedReasonId,
                        onChanged: (v) => setDialogState(() => selectedReasonId = v),
                        title: Text(r.reasonAr),
                        subtitle: r.chargesFee
                            ? Text('ممكن يترتب عليه رسوم ${r.feePercentage.toStringAsFixed(0)}%')
                            : null,
                        dense: true,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  TextField(
                    controller: freeTextController,
                    decoration: const InputDecoration(labelText: 'تفاصيل إضافية (اختياري)'),
                    maxLines: 2,
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('تراجع'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(
                  _CancelChoice(reasonId: selectedReasonId, freeText: freeTextController.text),
                ),
                child: const Text('تأكيد الإلغاء'),
              ),
            ],
          ),
        ),
      ),
    );
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

  Future<void> _payWithWallet() async {
    setState(() => _paying = true);
    try {
      await _paymentsRepository.payWithWallet(widget.orderId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتدفع من المحفظة بنجاح ✅')));
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _paying = false);
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
                      if (order.technicianId != null) ...[
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => ChatScreen(orderId: order.id)),
                          ),
                          icon: const Icon(Icons.chat_bubble_outline),
                          label: const Text('الشات مع الفني'),
                        ),
                      ],
                      if (_activeTrackingStatuses.contains(order.orderStatus)) ...[
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => TrackingScreen(
                                orderId: order.id,
                                orderNumber: order.orderNumber,
                                destination: order.address,
                              ),
                            ),
                          ),
                          icon: const Icon(Icons.location_on_outlined),
                          label: const Text('تتبّع الفني لحظياً'),
                        ),
                      ],
                      if (_payableOrderStatuses.contains(order.orderStatus) && order.paymentStatus != 'paid') ...[
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _paying ? null : _payWithWallet,
                          icon: const Icon(Icons.account_balance_wallet_outlined),
                          label: _paying
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Text('ادفع من المحفظة'),
                        ),
                      ],
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

class _CancelChoice {
  final String? reasonId;
  final String freeText;

  _CancelChoice({required this.reasonId, required this.freeText});
}
