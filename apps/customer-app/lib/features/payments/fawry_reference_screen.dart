import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../orders/orders_repository.dart';
import 'payments_repository.dart';

// شاشة الدفع بكود مرجعي فوري — مفيش WebView هنا خالص (عكس الكارت)، بس كود العميل ياخده لأقرب
// منفذ فوري ويدفعه كاش. نفس فلسفة CardPaymentScreen بالضبط لتأكيد الدفع (زرار "دفعت" + polling
// على GET /orders/:id لحد ما payment_status يبقى paid) لأن القفل النهائي هنا كمان عبر webhook
// غير متزامن، مش رد فوري من الشاشة.
class FawryReferenceScreen extends StatefulWidget {
  final String orderId;
  final FawryReference reference;

  const FawryReferenceScreen({super.key, required this.orderId, required this.reference});

  @override
  State<FawryReferenceScreen> createState() => _FawryReferenceScreenState();
}

enum _CheckState { idle, checking, confirmedPaid, stillPending }

class _FawryReferenceScreenState extends State<FawryReferenceScreen> {
  late final OrdersRepository _ordersRepository;
  _CheckState _checkState = _CheckState.idle;

  @override
  void initState() {
    super.initState();
    _ordersRepository = OrdersRepository(context.read<AuthRepository>());
  }

  Future<void> _confirmPayment() async {
    setState(() => _checkState = _CheckState.checking);
    for (var attempt = 0; attempt < 5; attempt++) {
      await Future<void>.delayed(const Duration(seconds: 2));
      final order = await _ordersRepository.getOne(widget.orderId);
      if (order.paymentStatus == 'paid') {
        if (mounted) {
          setState(() => _checkState = _CheckState.confirmedPaid);
          await Future<void>.delayed(const Duration(seconds: 1));
          if (mounted) Navigator.of(context).pop(true);
        }
        return;
      }
    }
    if (mounted) setState(() => _checkState = _CheckState.stillPending);
  }

  @override
  Widget build(BuildContext context) {
    final checking = _checkState == _CheckState.checking;
    final expiryText =
        '${widget.reference.expiresAt.day}/${widget.reference.expiresAt.month}/${widget.reference.expiresAt.year} — ${widget.reference.expiresAt.hour}:${widget.reference.expiresAt.minute.toString().padLeft(2, '0')}';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الدفع في أقرب فوري')),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'خد الكود ده لأقرب منفذ فوري وادفعه كاش. بعد الدفع، اضغط "دفعت" تحت.',
                style: TextStyle(fontSize: 15),
              ),
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      const Text('الكود المرجعي', style: TextStyle(color: Colors.grey)),
                      const SizedBox(height: 8),
                      SelectableText(
                        widget.reference.referenceNumber,
                        style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 2),
                      ),
                      const SizedBox(height: 12),
                      TextButton.icon(
                        icon: const Icon(Icons.copy),
                        label: const Text('نسخ الكود'),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: widget.reference.referenceNumber));
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتنسخ الكود')));
                        },
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text('الكود ده صالح لحد $expiryText', style: const TextStyle(color: Colors.grey)),
              const Spacer(),
              if (_checkState == _CheckState.stillPending)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    width: double.infinity,
                    color: Colors.amber.shade100,
                    padding: const EdgeInsets.all(12),
                    child: const Text(
                      'لسه مبيّن إن الدفع اتأكّد — لو دفعت فعلاً، الطلب هيتحدّث تلقائي خلال شوية.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              FilledButton(
                onPressed: checking ? null : _confirmPayment,
                child: checking
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_checkState == _CheckState.confirmedPaid ? 'اتأكّد الدفع ✅' : 'دفعت'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
