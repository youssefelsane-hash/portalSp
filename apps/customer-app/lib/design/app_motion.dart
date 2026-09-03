import 'package:flutter/widgets.dart';

/// أساس الحركة للتطبيق (docs/08 §122) — نفس المدد والمنحنى المستخدمين في الويب بالظبط،
/// عشان المنصات التلاتة تحس إنها منتج واحد مش تلات منتجات.
///
/// **صفر package جديدة**: كل اللي تحت مبني على widgets جاهزة في Flutter نفسه
/// (`AnimatedSwitcher`, `TweenAnimationBuilder`, `AnimatedContainer`). المالك طلب صراحة نبص
/// على المتاح built-in الأول، ومفيش هنا حاجة تستاهل تبعية خارجية.
///
/// المدد قصيرة عمدًا (120–260ms): فوق كده الواجهة بتحس **بطيئة** بدل ناعمة.
abstract final class AppMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 180);
  static const Duration slow = Duration(milliseconds: 260);

  /// بيبدأ سريع وبيهدى في الآخر — إحساس «استجابة فورية» بدل حركة مطّاطة.
  static const Curve ease = Curves.easeOutCubic;

  /// المستخدم اللي مفعّل «تقليل الحركة» في إعدادات نظامه بياخد نفس الواجهة بلا حركة.
  /// ده شرط وصول (accessibility) مش تحسين اختياري — في ناس الحركة بتسبّبلهم دوار فعلي.
  static bool disabled(BuildContext context) => MediaQuery.disableAnimationsOf(context);

  static Duration durationFor(BuildContext context, Duration d) => disabled(context) ? Duration.zero : d;
}

/// ظهور ناعم لمحتوى جديد: شفافية + إزاحة 4px لفوق.
///
/// الإزاحة الصغيرة هي اللي بتخلّي العين تلاحظ إن ده محتوى **جديد**؛ الإزاحة الكبيرة هي اللي
/// بتخلّي الشاشة تبان بتترجرج. مكافئ `.motion-rise` في الويب.
class MotionReveal extends StatelessWidget {
  const MotionReveal({super.key, required this.child, this.delay = Duration.zero});

  final Widget child;

  /// تأخير بسيط للعنصر جوّه قايمة — بيدّي إحساس ترتيب. خليه صغير (25ms للعنصر) وقف عند
  /// الثامن، وإلا بيتحوّل من «ترتيب» لـ«انتظار».
  final Duration delay;

  @override
  Widget build(BuildContext context) {
    if (AppMotion.disabled(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AppMotion.base + delay,
      curve: Interval(
        delay.inMilliseconds / (AppMotion.base + delay).inMilliseconds,
        1,
        curve: AppMotion.ease,
      ),
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0, 1),
        child: Transform.translate(offset: Offset(0, 4 * (1 - t)), child: child),
      ),
      child: child,
    );
  }
}

/// تأخير متدرّج لعنصر رقم [index] في قايمة — بيقف عند الثامن عمدًا.
Duration motionListDelay(int index) => Duration(milliseconds: (index.clamp(0, 7)) * 25);

/// رقم/مبلغ بيتغيّر — بيتبدّل بتلاشٍ قصير بدل ما ينطّ رقم مكان رقم.
///
/// أهم مكان في فلو الحجز يستاهل حركة: العميل بيغيّر خيار والسعر بيتبدّل **في صمت**. لو بصّته
/// مكانتش على الرقم في اللحظة دي مايعرفش إن اختياره أثّر أصلاً.
///
/// تلاشٍ مش عدّاد بيلف: الرقم لازم يفضل مقروء طول الوقت، والعدّاد الدوّار بيمنع ده في اللحظة
/// اللي المستخدم عايز يقرا فيها بالظبط.
class MotionValueText extends StatelessWidget {
  const MotionValueText(this.value, {super.key, this.style, this.textAlign});

  final String value;
  final TextStyle? style;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final text = Text(value, style: style, textAlign: textAlign);
    if (AppMotion.disabled(context)) return text;
    return AnimatedSwitcher(
      duration: AppMotion.slow,
      switchInCurve: AppMotion.ease,
      switchOutCurve: AppMotion.ease,
      // الافتراضي بيعمل تلاشي **متبادل** فالرقمين بيتراكبوا لحظة ويبانوا مشوّشين. هنا الرقم
      // الجديد بيدخل وهو طالع من تحت شوية — أوضح بكتير في مبلغ بيتحدّث.
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 0.18), end: Offset.zero).animate(animation),
          child: child,
        ),
      ),
      layoutBuilder: (current, previous) => Stack(
        alignment: AlignmentDirectional.centerEnd,
        children: [...previous, ?current],
      ),
      child: KeyedSubtree(key: ValueKey(value), child: text),
    );
  }
}

/// استجابة ضغط: تصغير بسيط جدًا وقت اللمس.
///
/// أصغر feedback ممكن وأكترهم إفادة — بيقول «الضغطة وصلت» **قبل** ما الشبكة ترد أصلاً، وده
/// اللي بيمنع الضغط المتكرر على نفس الزرار وقت الشبكة البطيئة.
class MotionPress extends StatefulWidget {
  const MotionPress({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  State<MotionPress> createState() => _MotionPressState();
}

class _MotionPressState extends State<MotionPress> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v && mounted) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    if (AppMotion.disabled(context) || widget.onTap == null) {
      return GestureDetector(onTap: widget.onTap, child: widget.child);
    }
    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      child: AnimatedScale(
        scale: _down ? 0.985 : 1,
        duration: AppMotion.fast,
        curve: AppMotion.ease,
        child: widget.child,
      ),
    );
  }
}
