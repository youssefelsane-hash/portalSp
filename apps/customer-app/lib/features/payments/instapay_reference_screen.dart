import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../orders/orders_repository.dart';
import 'payments_repository.dart';

// شاشة تحويل InstaPay — **وسيلة الدفع الأساسية للمنصة** (طلب مالك 2026-09-11)، فمتعاملة
// معاملة خاصة مش نسخة من شاشة Fawry.
//
// مفيش webhook خالص هنا (ADR-0013 §7): التأكيد يدوي من موظف Finance بعد ما يشوف التحويل
// (POST /admin/payments/:id/confirm-instapay). ده **مش عيب نعتذر عنه** — الوعد المعروض
// للعميل رقم صريح جاي من الإعدادات (عادةً ٢٠ دقيقة، بحد أقصى ساعة) بدل تحذير مبهم.
//
// تلات قواعد تصميمية هنا مالهاش حل تاني:
//   ١. **كل رقم في سطر مستقل بـLTR ومعاه زرار نسخ.** الحساب والمبلغ ورقم الطلب كانوا مدفونين
//      جوّه فقرة عربية؛ الـbidi بيقلب خانات الأرقام اللاتينية وسط العربي، والعميل بينسخ رقم
//      حساب غلط — على تحويل بنكي حقيقي مش على شاشة عرض.
//   ٢. **الشاشة بتستأنف نفسها.** العميل **لازم** يسيب تطبيقنا ويفتح تطبيق البنك ويرجع؛ ده
//      الاستخدام الطبيعي لـInstaPay مش حالة شاذة. فالشاشة بتقدر تجيب تفاصيلها بنفسها من
//      `GET /orders/:id/instapay-transfer` (قراءة بحتة) بدل ما تعتمد على كائن اتمرّرلها.
//   ٣. **الرجوع من الخلفية بيعيد الفحص تلقائيًا.** لو الموظف أكّد التحويل والعميل راجع
//      للتطبيق، الشاشة تكتشف ده لوحدها من غير ما يدوس حاجة.
class InstaPayReferenceScreen extends StatefulWidget {
  final String orderId;

  /// التفاصيل المعروفة وقت فتح الشاشة. `null` = الشاشة تجيبها بنفسها — ده مسار «رجعت
  /// للتطبيق عشان أنسخ الرقم» اللي مابيكونش معاه كائن متمرَّر.
  final InstaPayReference? reference;

  const InstaPayReferenceScreen({super.key, required this.orderId, this.reference});

  @override
  State<InstaPayReferenceScreen> createState() => _InstaPayReferenceScreenState();
}

enum _CheckState { idle, checking, confirmedPaid, stillPending }

class _InstaPayReferenceScreenState extends State<InstaPayReferenceScreen> with WidgetsBindingObserver {
  late final OrdersRepository _ordersRepository;
  late final PaymentsRepository _paymentsRepository;
  _CheckState _checkState = _CheckState.idle;
  InstaPayReference? _reference;
  String? _loadError;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _ordersRepository = OrdersRepository(context.read<AuthRepository>());
    _paymentsRepository = PaymentsRepository(context.read<AuthRepository>());
    _reference = widget.reference;
    WidgetsBinding.instance.addObserver(this);
    if (_reference == null) _loadReference();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// العميل رجع من تطبيق البنك — نشوف لوحدنا هل التحويل اتأكّد، من غير ما يدوس حاجة.
  ///
  /// من غير ده، العميل اللي حوّل فعلاً بيرجع يلاقي نفس الشاشة ساكتة ومش عارف إيه اللي حصل.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    if (_checkState == _CheckState.checking || _checkState == _CheckState.confirmedPaid) return;
    _refreshPaymentStatus();
  }

  Future<void> _loadReference() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final reference = await _paymentsRepository.getInstaPayTransfer(widget.orderId);
      if (mounted) setState(() => _reference = reference);
    } catch (_) {
      if (mounted) {
        setState(() => _loadError = 'مش قادرين نجيب بيانات التحويل دلوقتي — جرّب تاني');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// فحص صامت لحالة الدفع: بيقفل الشاشة لو اتأكّد، وبيسكت لو لسه — **من غير ما يقلق العميل**.
  Future<void> _refreshPaymentStatus() async {
    try {
      final order = await _ordersRepository.getOne(widget.orderId);
      if (!mounted || order.paymentStatus != 'paid') return;
      setState(() => _checkState = _CheckState.confirmedPaid);
      await Future<void>.delayed(const Duration(seconds: 1));
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      // فشل الشبكة هنا مالوش أي أثر مرئي — ده فحص إضافي مش مسار أساسي.
    }
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

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(2)} ج.م';

  void _copy(String value, String doneMessage) {
    Clipboard.setData(ClipboardData(text: value));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(doneMessage), duration: const Duration(seconds: 2)));
  }

  @override
  Widget build(BuildContext context) {
    final reference = _reference;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الدفع عبر InstaPay')),
        body: reference == null ? _buildLoadingOrError() : _buildTransfer(reference),
      ),
    );
  }

  Widget _buildLoadingOrError() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_loadError ?? 'مفيش تحويل مفتوح على الطلب ده', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: _loadReference, child: const Text('حاول تاني')),
          ],
        ),
      ),
    );
  }

  Widget _buildTransfer(InstaPayReference reference) {
    final scheme = Theme.of(context).colorScheme;
    final checking = _checkState == _CheckState.checking;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // **المحتوى قابل للتمرير والزرار مثبّت تحت** — العمود الثابت كان بيعمل RenderFlex
          // overflow أول ما يتضاف أي محتوى (QR، أو خط نظام مكبّر). نفس فئة بَقّة §76-ب.
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ① المبلغ أولاً: أول سؤال في دماغ العميل «أحوّل كام؟».
                  if (reference.amountCents != null)
                    _TransferAmountCard(amountText: _formatEgp(reference.amountCents!)),
                  if (reference.amountCents != null) const SizedBox(height: 12),

                  // ② الحساب — **أهم سطر في الشاشة**، وأخطر واحد لو اتقرا غلط.
                  if (reference.recipientAddress != null && reference.recipientAddress!.isNotEmpty)
                    _CopyableValueCard(
                      icon: Icons.account_balance_wallet_outlined,
                      label: 'حوّل على الحساب ده',
                      value: reference.recipientAddress!,
                      subtitle: reference.recipientName,
                      emphasized: true,
                      onCopy: () => _copy(reference.recipientAddress!, 'اتنسخ رقم الحساب'),
                    ),
                  if (reference.recipientAddress != null && reference.recipientAddress!.isNotEmpty)
                    const SizedBox(height: 12),

                  // ③ رقم الطلب — لازم يتكتب في ملاحظة التحويل عشان الموظف يربط التحويل بالطلب.
                  _CopyableValueCard(
                    icon: Icons.tag,
                    label: 'اكتب رقم الطلب ده في ملاحظة التحويل',
                    value: reference.referenceCode,
                    onCopy: () => _copy(reference.referenceCode, 'اتنسخ رقم الطلب'),
                  ),
                  const SizedBox(height: 16),

                  if (reference.qrImageUrl != null) ...[
                    _InstaPayQrCard(imageUrl: reference.qrImageUrl!),
                    const SizedBox(height: 16),
                  ],

                  // ④ الخطوات بالكلام — الأرقام كلها فوق، فالفقرة دي مفيهاش رقم يتلخبط.
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.info_outline, size: 20, color: scheme.secondary),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              reference.instructionsAr,
                              style: const TextStyle(fontSize: 15, height: 1.6),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // ⑤ وعد وقت التأكيد — **رقم صريح، مش تحذير**. طلب مالك: «مش عايزين نبين
                  //    للناس إن هي بتاخد وقت… ٢٠ دقيقة ده الطبيعي، وmaximum ساعة».
                  _ConfirmationPromiseCard(
                    typicalMinutes: reference.confirmTypicalMinutes,
                    maxMinutes: reference.confirmMaxMinutes,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_checkState == _CheckState.stillPending)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  color: scheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                padding: const EdgeInsets.all(12),
                child: Text(
                  'وصلنا إنك حوّلت ✅ بنراجع التحويل دلوقتي، وهيوصلك إشعار أول ما يتأكّد. '
                  'تقدر تقفل الشاشة عادي — مش محتاج تستنى هنا.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSecondaryContainer),
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
    );
  }
}

/// المبلغ المطلوب تحويله — رقم واحد كبير، بلا أي نص حواليه يشتّت.
class _TransferAmountCard extends StatelessWidget {
  const _TransferAmountCard({required this.amountText});

  final String amountText;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        child: Column(
          children: [
            Text(
              'المبلغ المطلوب',
              style: TextStyle(color: scheme.onPrimaryContainer, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                amountText,
                style: TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.bold,
                  color: scheme.onPrimaryContainer,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// سطر قيمة قابل للنسخ — **القيمة لوحدها في سطر مستقل بـLTR**.
///
/// ده حل مشكلة حقيقية مش تجميل: رقم لاتيني جوّه سياق عربي بيتعرض بترتيب خانات مقلوب
/// (bidi)، فالعميل بينسخه أو يكتبه غلط. `Directionality(ltr)` + `TextAlign.left` بيثبّتوا
/// الترتيب، و`SelectableText` بتخلّي النسخ اليدوي شغّال كمان لو زرار النسخ اتعطّل.
class _CopyableValueCard extends StatelessWidget {
  const _CopyableValueCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.onCopy,
    this.subtitle,
    this.emphasized = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final String? subtitle;
  final bool emphasized;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final foreground = emphasized ? scheme.onPrimaryContainer : scheme.onSurface;
    return Card(
      color: emphasized ? scheme.primaryContainer : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: foreground),
                const SizedBox(width: 6),
                // بلا Flexible النص العربي الطويل بيتجاوز على شاشة ٣٢٠ بكسل (بَقّة بيكسل حقيقية).
                Flexible(
                  child: Text(
                    label,
                    style: TextStyle(color: foreground, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // القيمة في سطر لوحدها، LTR، وبخط أحادي المسافة عشان الخانات تتقرا واحدة واحدة.
            Directionality(
              textDirection: TextDirection.ltr,
              child: SelectableText(
                value,
                textAlign: TextAlign.left,
                style: TextStyle(
                  fontSize: emphasized ? 24 : 20,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                  fontFamilyFallback: const ['monospace'],
                  color: foreground,
                ),
              ),
            ),
            if (subtitle != null && subtitle!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                style: TextStyle(fontSize: 13, color: foreground.withValues(alpha: 0.75)),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.tonalIcon(
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('نسخ'),
              onPressed: onCopy,
            ),
          ],
        ),
      ),
    );
  }
}

/// وعد وقت التأكيد — **رقم صريح بدل تحذير**.
///
/// طلب مالك 2026-09-11: «مش عايزين نبين للناس إن هي بتاخد وقت… ٢٠ دقيقة ده الطبيعي،
/// وmaximum ساعة». النص القديم («ممكن ياخد وقت أطول من الكارت/فوري») كان بيقارن وسيلتنا
/// الأساسية بغيرها في غير صالحها — وده عكس المطلوب بالظبط.
class _ConfirmationPromiseCard extends StatelessWidget {
  const _ConfirmationPromiseCard({required this.typicalMinutes, required this.maxMinutes});

  final int typicalMinutes;
  final int maxMinutes;

  /// ٦٠ دقيقة بتتقري «ساعة» — الناس بتفكّر بالساعات مش بستين دقيقة.
  String _humanize(int minutes) {
    if (minutes < 60) return '$minutes دقيقة';
    if (minutes == 60) return 'ساعة';
    if (minutes % 60 == 0) return '${minutes ~/ 60} ساعات';
    return '$minutes دقيقة';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.verified_outlined, size: 20, color: scheme.primary),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'التأكيد عادةً خلال ${_humanize(typicalMinutes)}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'وبحد أقصى ${_humanize(maxMinutes)}. هيوصلك إشعار أول ما يتأكّد — '
                    'مش محتاج تفضل فاتح الشاشة.',
                    style: const TextStyle(fontSize: 13, height: 1.5),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// كارت الـQR — صورة مربّعة على خلفية بيضا دايمًا.
///
/// **الخلفية البيضا مقصودة ومش نسيان للوضع الداكن**: قارئات QR بتتوقّع مربّعات غامقة على خلفية
/// فاتحة، وعرض الصورة على سطح غامق بيكسر القراءة على أجهزة كتير. ده الاستثناء الوحيد المبرَّر
/// لتثبيت لون هنا — عكس بَقّة §78-أ اللي كانت تثبيت لون بلا سبب.
class _InstaPayQrCard extends StatelessWidget {
  const _InstaPayQrCard({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        child: Column(
          children: [
            Text(
              'أو امسح الكود ده من تطبيق البنك',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 14),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 220, maxHeight: 220),
              child: DecoratedBox(
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Image.network(
                    imageUrl,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    // فشل تحميل الصورة ما يكسرش الشاشة: التعليمات النصية تحت فيها كل اللي
                    // العميل محتاجه، فبنخفي الكارت بهدوء بدل أيقونة صورة مكسورة.
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
