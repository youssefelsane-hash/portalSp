import 'package:flutter/material.dart';

/// بديل بصري لدائرة التحميل الافتراضية وسط الشاشة (docs/12) — بيحجز نفس شكل/مساحة القايمة
/// الحقيقية الجاية بدل ما الشاشة تقفز (layout shift) لحظة وصول البيانات. نفس فلسفة
/// apps/admin's TableSkeleton، بس Card-based (مفيش جداول في Flutter هنا).
///
/// ## بَقّة حقيقية اتلقطت واتقاست (بلاغ المالك 2026-09-11: «الشرايط الصفرا والسودا في السيرش»)
///
/// الودجت دي كانت `Column` بارتفاع ثابت: 4 عناصر × (72 + 8) + حشو 32 = **352px**، ومن غير
/// أي تمرير. في شاشة البحث الارتفاع المتاح بيبقى `640 - 56 (شريط) - 300 (كيبورد) = 284px`،
/// فالنتيجة `A RenderFlex overflowed by 68 pixels on the bottom` — الشرايط بالظبط.
///
/// **والمشكلة مكانتش في شاشة البحث**: الودجت دي مستخدمة في **٢٦ مكان** في التطبيقين، وكل
/// واحد فيهم كان بيعمل نفس الحاجة أول ما الارتفاع المتاح يقلّ عن 352px — كيبورد مفتوح، شاشة
/// صغيرة، أو خط نظام مكبّر. عشان كده الإصلاح هنا مش في الشاشة اللي اتشكي منها.
///
/// **الإصلاح**: الهيكل العظمي بياخد قد المساحة اللي عنده. `LayoutBuilder` بيحسب كام عنصر
/// بيدخل فعلاً؛ ولو المساحة أقل من عنصر واحد بيرسم عنصر واحد بارتفاع المساحة. مفيش حالة
/// بيتجاوز فيها — مش «رقم أكبر» يفضل قنبلة موقوتة.
class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.itemCount = 4, this.itemHeight = 72});

  final int itemCount;
  final double itemHeight;

  static const double _gap = 8;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;

    Widget column(int count, {double? height}) => Column(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(
            count,
            (i) => Padding(
              padding: const EdgeInsets.only(bottom: _gap),
              child: _Pulse(
                child: Container(
                  height: height ?? itemHeight,
                  decoration: BoxDecoration(
                    color: base,
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ),
        );

    return LayoutBuilder(
      builder: (context, constraints) {
        // ارتفاع غير مقيّد (جوّه scroll view مثلاً) — العدد الكامل، زي الأول بالظبط.
        if (!constraints.maxHeight.isFinite) return column(itemCount);

        final fits = (constraints.maxHeight / (itemHeight + _gap)).floor();
        if (fits >= itemCount) return column(itemCount);
        if (fits >= 1) return column(fits);
        // مساحة أقل من عنصر واحد: عنصر واحد بارتفاع اللي متاح.
        return column(1, height: (constraints.maxHeight - _gap).clamp(0.0, itemHeight));
      },
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse({required this.child});
  final Widget child;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(opacity: Tween(begin: 0.5, end: 1.0).animate(_controller), child: widget.child);
  }
}
