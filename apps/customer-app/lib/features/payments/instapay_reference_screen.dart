import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../orders/orders_repository.dart';
import 'payments_repository.dart';

// نفس نمط FawryReferenceScreen بالحرف — فرق جوهري واحد: مفيش webhook خالص هنا (ADR-0013 §7)،
// التأكيد يدوي بس من موظف Finance بعد ما يشوف التحويل فعليًا (POST /admin/payments/:id/confirm-instapay).
// يعني الـpolling هنا (5 محاولات كل ثانيتين) متفائل زيادة عن اللازم غالبًا — العميل هيشوف
// "لسه بيتأكد" في الغالبية العظمى من المرات، ده متوقّع ومش خطأ. رسالة الانتظار هنا موضّحة عشان
// كده تحديدًا، بعكس Fawry/الكارت اللي فعلاً بيتأكدوا خلال ثواني عادةً.
class InstaPayReferenceScreen extends StatefulWidget {
  final String orderId;
  final InstaPayReference reference;

  const InstaPayReferenceScreen({super.key, required this.orderId, required this.reference});

  @override
  State<InstaPayReferenceScreen> createState() => _InstaPayReferenceScreenState();
}

enum _CheckState { idle, checking, confirmedPaid, stillPending }

class _InstaPayReferenceScreenState extends State<InstaPayReferenceScreen> {
  late final OrdersRepository _ordersRepository;
  late final PaymentsRepository _paymentsRepository;
  _CheckState _checkState = _CheckState.idle;

  @override
  void initState() {
    super.initState();
    _ordersRepository = OrdersRepository(context.read<AuthRepository>());
    _paymentsRepository = PaymentsRepository(context.read<AuthRepository>());
  }

  Future<void> _confirmPayment() async {
    setState(() => _checkState = _CheckState.checking);
    // بَقّة حقيقية اتصلحت: الزرار ده كان بيعمل polling محلي بس من غير ما يسجّل في الباك-إند إن
    // العميل ادّعى التحويل — الأدمن مكانش عنده أي طريقة يعرف مين ضغط الزرار أصلاً قبل التأكيد.
    try {
      await _paymentsRepository.confirmInstaPayTransfer(widget.orderId);
    } catch (_) {
      // مش بلوكر — لو الشبكة قطعت هنا، الـpolling تحت لسه بيحاول يكتشف تأكيد الأدمن نفسه.
    }
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
        appBar: AppBar(title: const Text('الدفع عبر InstaPay')),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // البطاقة دي هي أهم حاجة في الشاشة (تنظيم واضح، طلب صريح من صاحب المشروع
              // 2026-08-21) — الكود ده لازم يتكتب في ملاحظة التحويل فعليًا (نفس القيمة بالحرف في
              // instructionsAr تحت)، فهي أول حاجة العميل يشوفها، بلون مميّز، مش كارت عادي وسط
              // كارت تاني. قبل كده كان الكود المعروض مختلف عن الكود المطلوب فعليًا في التعليمات
              // (بَقّة حقيقية اتصلحت في الباك-إند — راجع instapay-provider.service.ts).
              Card(
                color: Theme.of(context).colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.tag, size: 18, color: Theme.of(context).colorScheme.onPrimaryContainer),
                          const SizedBox(width: 6),
                          Text(
                            'اكتب الكود ده في ملاحظة التحويل',
                            style: TextStyle(color: Theme.of(context).colorScheme.onPrimaryContainer, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      SelectableText(
                        widget.reference.referenceCode,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 2,
                          color: Theme.of(context).colorScheme.onPrimaryContainer,
                        ),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.tonalIcon(
                        icon: const Icon(Icons.copy, size: 18),
                        label: const Text('نسخ الكود'),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: widget.reference.referenceCode));
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('اتنسخ الكود')));
                        },
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.info_outline, size: 20, color: Theme.of(context).colorScheme.secondary),
                      const SizedBox(width: 10),
                      Expanded(child: Text(widget.reference.instructionsAr, style: const TextStyle(fontSize: 15, height: 1.6))),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              if (_checkState == _CheckState.stillPending)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    width: double.infinity,
                    color: Colors.amber.shade100,
                    padding: const EdgeInsets.all(12),
                    child: const Text(
                      'التحويل بيتأكّد يدويًا من فريقنا — ممكن ياخد وقت أطول من الكارت/فوري. لو حوّلت '
                      'فعلاً بنفس الكود، هتوصلك رسالة تأكيد لما يتم المراجعة.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              FilledButton(
                onPressed: checking ? null : _confirmPayment,
                child: checking
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_checkState == _CheckState.confirmedPaid ? 'اتأكّد الدفع ✅' : 'حوّلت الفلوس'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
