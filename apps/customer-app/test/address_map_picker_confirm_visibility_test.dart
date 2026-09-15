import 'package:customer_app/design/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// **بلاغ المالك 2026-09-15**: «فوق على الشمال المفروض ظاهر زرار تأكيد الموقع. الكلمة دي مش
/// ظاهرة للعميل، ولكن مكان الزرار بيدوس وبيشتغل.»
///
/// السبب كان `Colors.white` **ثابت** على نص الزرار، و`AppBarTheme` في الوضع الفاتح خلفيته
/// `Colors.white` كمان — أبيض على أبيض. الزرار شغّال وبس غير مقروء، وده أسوأ من غيابه.
///
/// الاختبار ده بيقيس **التباين نفسه** مش شكل الويدجت: لو أي حد رجّع لونًا ثابتًا على أي
/// خلفية، الفحص بيقع. بيتشغّل في الوضعين لأن البَقّة كانت في واحد منهم بس.
void main() {
  /// `AppBar` مبسّط بنفس تركيب شاشة اختيار الموقع — الجزء اللي البَقّة كانت فيه بالحرف.
  Widget harness(ThemeData theme) => MaterialApp(
        theme: theme,
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            appBar: AppBar(
              title: const Text('حدد موقعك على الخريطة'),
              actions: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  child: FilledButton.icon(
                    onPressed: () {},
                    icon: const Icon(Icons.check, size: 18),
                    label: const Text('تأكيد الموقع'),
                  ),
                ),
              ],
            ),
            body: const SizedBox.shrink(),
          ),
        ),
      );

  /// المسافة الإدراكية بين لونين (0 = متطابقين تمامًا = غير مقروء).
  double contrast(Color a, Color b) {
    double luminance(Color c) => c.computeLuminance();
    final l1 = luminance(a);
    final l2 = luminance(b);
    final lighter = l1 > l2 ? l1 : l2;
    final darker = l1 > l2 ? l2 : l1;
    return (lighter + 0.05) / (darker + 0.05);
  }

  for (final entry in {'الفاتح': AppTheme.light(), 'الغامق': AppTheme.dark()}.entries) {
    testWidgets('زرار «تأكيد الموقع» مقروء في الوضع ${entry.key}', (tester) async {
      final theme = entry.value;
      await tester.pumpWidget(harness(theme));

      expect(find.text('تأكيد الموقع'), findsOneWidget);

      // لون النص الفعلي بعد ما الثيم اتطبّق — مش اللي مكتوب في الكود.
      final label = tester.widget<Text>(find.text('تأكيد الموقع'));
      final renderedStyle = DefaultTextStyle.of(
        tester.element(find.text('تأكيد الموقع')),
      ).style.merge(label.style);
      final foreground = renderedStyle.color ?? theme.colorScheme.onPrimary;

      // خلفية الزرار نفسه (مش خلفية الـAppBar) هي اللي النص واقف عليها.
      final background = theme.colorScheme.primary;

      final ratio = contrast(foreground, background);
      expect(
        ratio,
        greaterThan(3.0),
        reason:
            'نص الزرار ($foreground) على خلفيته ($background) نسبة تباين $ratio — '
            'ده معناه إن الزرار موجود وبيشتغل بس العميل مش شايفه، وهي البَقّة الأصلية بالحرف.',
      );

      // **الحارس الجوهري**: الزرار لازم يكون ليه خلفية **مختلفة عن خلفية الـAppBar**.
      //
      // ده اللي بيفرّق بين الحالة السليمة والبَقّة الأصلية: `FilledButton` بيرسم خلفيته
      // بنفسه فنصه الأبيض مقروء عليها، بينما `TextButton` بنص أبيض بيقعد على خلفية الـAppBar
      // البيضا مباشرةً ويختفي. مقارنة لون النص بخلفية الـAppBar وحدها مش كافية — النص هنا
      // أبيض فعلاً وده **صح** لأنه واقف على أزرق، مش على أبيض.
      final appBarBackground = theme.appBarTheme.backgroundColor ?? theme.colorScheme.surface;
      expect(
        contrast(background, appBarBackground),
        greaterThan(1.5),
        reason:
            'خلفية الزرار ($background) قريبة جدًا من خلفية الـAppBar ($appBarBackground)، '
            'يعني الزرار مالوش حدود بصرية — ولو نصه فاتح كمان هيختفي زي البلاغ الأصلي.',
      );
    });
  }
}
