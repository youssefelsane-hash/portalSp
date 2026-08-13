import 'package:flutter/material.dart';

/// بديل بصري لدائرة التحميل الافتراضية وسط الشاشة (docs/12) — بيحجز نفس شكل/مساحة القايمة
/// الحقيقية الجاية بدل ما الشاشة تقفز (layout shift) لحظة وصول البيانات. نفس فلسفة
/// apps/admin's TableSkeleton، بس Card-based (مفيش جداول في Flutter هنا).
class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.itemCount = 4, this.itemHeight = 72});

  final int itemCount;
  final double itemHeight;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return Column(
      children: List.generate(
        itemCount,
        (i) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _Pulse(
            child: Container(
              height: itemHeight,
              decoration: BoxDecoration(color: base, borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ),
      ),
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
