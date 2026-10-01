import 'package:flutter/material.dart';

import '../catalog/models.dart';
import '../catalog/pricing_field_widgets.dart';

bool shouldCollapseCheckoutReview({
  required Map<String, dynamic>? previousAnswers,
  required List<PricingField> fields,
  required Map<String, dynamic> values,
}) =>
    previousAnswers?.isNotEmpty == true &&
    fields.isNotEmpty &&
    !fields.any((field) => field.isRequired && !field.isSupported) &&
    firstIncompletePricingField(fields, values) == null;

void focusCheckoutPayment(
  GlobalKey key, {
  required bool Function() userInteracted,
}) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (userInteracted()) return;
    final target = key.currentContext;
    if (target == null || !target.mounted) return;
    final scrollable = Scrollable.maybeOf(target);
    if (scrollable == null ||
        scrollable.position.pixels > scrollable.position.minScrollExtent + 1) {
      return;
    }
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(target) ?? false;
    Scrollable.ensureVisible(
      target,
      duration: reduceMotion
          ? Duration.zero
          : const Duration(milliseconds: 420),
      curve: Curves.easeOutCubic,
      alignment: 0.12,
    );
  });
  // الـAPI ممكن يكمّل بعد آخر frame؛ من غير واحد جديد الـcallback مش هيتنفّذ.
  WidgetsBinding.instance.scheduleFrame();
}

class CheckoutReviewSection extends StatelessWidget {
  const CheckoutReviewSection({
    super.key,
    required this.expanded,
    required this.complete,
    required this.onToggle,
    required this.child,
  });

  final bool expanded;
  final bool complete;
  final VoidCallback onToggle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: Column(
      children: [
        ListTile(
          key: const ValueKey('checkout-review-toggle'),
          leading: const Icon(Icons.fact_check_outlined),
          title: const Text('تفاصيل الخدمة'),
          subtitle: Text(
            !complete
                ? 'كمّل البيانات المطلوبة'
                : expanded
                ? 'تقدر تراجع أو تعدّل اختياراتك'
                : 'اضغط السهم لو عايز تراجع أو تعدّل',
          ),
          trailing: Icon(expanded ? Icons.expand_less : Icons.expand_more),
          onTap: onToggle,
        ),
        if (expanded)
          Padding(padding: const EdgeInsets.fromLTRB(8, 0, 8, 8), child: child),
      ],
    ),
  );
}
