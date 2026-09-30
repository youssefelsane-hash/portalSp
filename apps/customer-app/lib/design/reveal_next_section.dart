import 'package:flutter/widgets.dart';

/// **تمرير هادي للخطوة الجاية** (docs/08 §189 UX-3).
///
/// بعد ما العميل يختار حاجة (اليوم، الساعة، العنوان) الصفحة بتنزل **بالقدر اللي يبيّن الجزء
/// الجاي بس** — `keepVisibleAtEnd` مابيحرّكش لو الجزء ظاهر أصلاً، ومابيرمي العميل لأول الصفحة.
/// ده فرق «سيكة صغيرة» عن «قفزة»: المستخدم غير التقني بيعرف إن فيه خطوة تحت من غير ما يحس إن
/// الشاشة اتحرّكت لوحدها.
///
/// بيحترم «تقليل الحركة» في إعدادات الموبايل (من غير أنيميشن)، وبيستنى الـframe الجاي عشان
/// الجزء اللي لسه ظاهر يتحسب مكانه صح. لو المفتاح مش مرسوم مابيعملش حاجة.
void revealNextSection(GlobalKey key) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    final target = key.currentContext;
    if (target == null || !target.mounted) return;
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(target) ?? false;
    Scrollable.ensureVisible(
      target,
      duration: reduceMotion
          ? Duration.zero
          : const Duration(milliseconds: 420),
      curve: Curves.easeOutCubic,
      alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
    );
  });
}
