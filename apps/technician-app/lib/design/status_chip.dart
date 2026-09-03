import 'package:flutter/material.dart';
import 'app_motion.dart';
import 'app_theme.dart';

/// نغمة دلالية للحالة — نفس الخمس نغمات المستخدمة في apps/admin (StatusChip): نجاح/تحذير/خطر/
/// معلومة/محايد. القرار مين ياخد أنهي نغمة بيبقى في lib الخاص بكل ميزة (order-labels.dart مثلاً)
/// مش هنا، نفس فلسفة admin (لازم تعريب أي enum خام من الباك-إند قبل ما يوصل للمستخدم).
enum StatusTone { success, warning, danger, info, neutral }

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.tone});

  final String label;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = _colors(context);
    // docs/08 §122 — تغيير الحالة بيتلوّن بتدرّج والنص بيتبدّل بتلاشٍ، بدل ما الشارة تنطّ لون
    // ونص تانيين في إطار واحد. الحالة هي أهم معلومة في الشاشة، والانتقال الناعم هو اللي
    // بيخلّي المستخدم **يلاحظ** إنها اتغيّرت بدل ما يكتشف بعدين إنه بيبص على حالة جديدة.
    return AnimatedContainer(
      duration: AppMotion.durationFor(context, AppMotion.slow),
      curve: AppMotion.ease,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: MotionValueText(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg, fontWeight: FontWeight.w600),
      ),
    );
  }

  (Color, Color) _colors(BuildContext context) {
    switch (tone) {
      case StatusTone.success:
        return (context.successColor, context.successColor.withValues(alpha: 0.12));
      case StatusTone.warning:
        return (context.warningColor, context.warningColor.withValues(alpha: 0.12));
      case StatusTone.danger:
        return (context.dangerColor, context.dangerColor.withValues(alpha: 0.12));
      case StatusTone.info:
        return (context.infoColor, context.infoColor.withValues(alpha: 0.12));
      case StatusTone.neutral:
        final c = Theme.of(context).colorScheme.onSurfaceVariant;
        return (c, c.withValues(alpha: 0.12));
    }
  }
}
