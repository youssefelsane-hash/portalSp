import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../core/auth_repository.dart';
import '../orders/orders_repository.dart';

// شاشة الدفع بالبطاقة — بتفتح iframe Paymob المستضاف (redirect_url) في WebView. مفيش return_url
// مُعدّ في تكامل Paymob (راجع docs/03-external-integrations.md) — يعني القفل النهائي بيحصل
// عبر webhook مش عن طريق رصد تنقّل الصفحة، فمفيش طريقة موثوقة نكتشف بيها "خلص" من داخل الـ WebView
// نفسه. الحل: زرار "خلصت الدفع" بعد ما المستخدم يكمّل داخل الـ iframe، وبعدين بنسأل الباك-إند
// (GET /orders/:id) كذا مرة بفاصل قصير لحد ما payment_status يتحدّث أو نستسلم ونرجّع "لسه بيتأكد".
class CardPaymentScreen extends StatefulWidget {
  final String orderId;
  final String redirectUrl;

  const CardPaymentScreen({super.key, required this.orderId, required this.redirectUrl});

  @override
  State<CardPaymentScreen> createState() => _CardPaymentScreenState();
}

enum _CheckState { idle, checking, confirmedPaid, stillPending }

class _CardPaymentScreenState extends State<CardPaymentScreen> {
  late final WebViewController _controller;
  late final OrdersRepository _ordersRepository;
  _CheckState _checkState = _CheckState.idle;

  @override
  void initState() {
    super.initState();
    _ordersRepository = OrdersRepository(context.read<AuthRepository>());
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse(widget.redirectUrl));
  }

  Future<void> _confirmPayment() async {
    setState(() => _checkState = _CheckState.checking);
    // 5 محاولات كل 2 ثانية — الـ webhook عادةً بيوصل خلال ثواني، مش فوري تماماً.
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
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الدفع بالبطاقة')),
        body: Column(
          children: [
            Expanded(child: WebViewWidget(controller: _controller)),
            if (_checkState == _CheckState.stillPending)
              Container(
                width: double.infinity,
                color: Colors.amber.shade100,
                padding: const EdgeInsets.all(12),
                child: const Text(
                  'لسه مبيّن إن الدفع اتأكّد — لو دفعت فعلاً، الطلب هيتحدّث تلقائي خلال شوية. اقفل الشاشة وتابع حالة الطلب.',
                  textAlign: TextAlign.center,
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton(
                onPressed: checking ? null : _confirmPayment,
                child: checking
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_checkState == _CheckState.confirmedPaid ? 'اتأكّد الدفع ✅' : 'خلصت الدفع'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
