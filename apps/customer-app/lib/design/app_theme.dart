import 'package:flutter/material.dart';

/// نظام التصميم المشترك — **نسبة تطبيق اللون محكومة بـADR-0093** (بلاغ مالك، docs/08 §144).
///
/// القاعدة: ~٩٠٪ محايد بارد · ~٧٪ كحلي للأفعال · ~٣٪ نحاسي لمسة علامة.
/// الهوية (كحلي + نحاسي) من ADR-0092 زي ما هي — اللي اتغيّر هو **فين** بيتحطّوا.
class AppColors {
  AppColors._();

  /// لون الفعل: الزرار الأساسي، التبويب المختار، اللينك، حلقة التركيز، قرص الساعة.
  static const primary = Color(0xFF123B69);
  static const primaryDark = Color(0xFFA9C4E4);

  /// **لمسة العلامة — قايمة استخدام مقفولة (ADR-0093 §2)**: الرمز، عنوان صفحة البداية، سهم
  /// زرار البحث، شيفرون «عرض الكل»، نجوم التقييم. وبس.
  ///
  /// ممنوع على: أي زرار أساسي عام، التبويب المختار، اختيار الساعة/التاريخ، شرايح الحالة،
  /// أشرطة التقدّم، خلفيات الكروت، أو أي مساحة مصمتة أكبر من أيقونة. اللون ده بيشتغل لأنه
  /// نادر؛ أول ما يتكرر بيتحوّل لضوضاء — وده بالظبط اللي ADR-0093 اتكتبت تصلحه.
  static const accent = Color(0xFFB54724);
  static const accentDark = Color(0xFFEF9A6D);

  static const success = Color(0xFF3C8B4A);
  static const successDark = Color(0xFF6FBF7A);

  static const warning = Color(0xFFC98A1F);
  static const warningDark = Color(0xFFE0AC4E);

  /// أزرق «شغّال دلوقتي» في تطبيق الفني — مستقل عن `primary` عمدًا عشان الحالة تفضل حالة
  /// حتى لو لون الأفعال اتغيّر.
  static const info = Color(0xFF2563A8);
  static const infoDark = Color(0xFF8AB4D2);

  // danger بيستخدم colorScheme.error مباشرة (نفس فلسفة admin's --danger: var(--destructive)).
}

/// مسافات ثابتة — بدل أرقام متفرقة (8، 12، 16، 24) مكررة في كل شاشة.
class AppSpacing {
  AppSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
}

class AppTheme {
  AppTheme._();

  /// **ممنوع `ColorScheme.fromSeed` هنا (ADR-0093 §4).**
  ///
  /// `fromSeed` مابتستخدمش اللون اللي بتديهولها — بتولّد لوحة كاملة بخوارزمية Material.
  /// القياس الفعلي على نسخة Flutter بتاعة المشروع بـseed النحاسي `#B54724` طلّع:
  /// `primary #8F4C37` (بنّي مش نحاسي) · `surface #FFF8F6` (أبيض وردي) ·
  /// `secondaryContainer #FFDBD1` (سلموني) · `tertiaryContainer #F5E2A7` (**خردلي** — لون
  /// مالوش أي وجود في الهوية) · `outlineVariant #D8C2BC` (حدود بنّية وردية).
  ///
  /// يعني كل سطح وكل حد في التطبيق كان بياخد صبغة محدش اختارها. القيم هنا مكتوبة بالاسم عشان
  /// اللي في الكود هو اللي على الشاشة، ومايتغيّرش مع ترقية Flutter.
  static const ColorScheme _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.primary,
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFDCE6F2),
    onPrimaryContainer: Color(0xFF0C2745),
    secondary: Color(0xFF4A5567),
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Color(0xFFE6E9EF),
    onSecondaryContainer: Color(0xFF252C38),
    tertiary: AppColors.accent,
    onTertiary: Color(0xFFFFFFFF),
    tertiaryContainer: Color(0xFFF7E3DA),
    onTertiaryContainer: Color(0xFF5C2011),
    error: Color(0xFFC0392B),
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFBE3E0),
    onErrorContainer: Color(0xFF5C130C),
    surface: Color(0xFFFFFFFF),
    onSurface: Color(0xFF141A22),
    surfaceDim: Color(0xFFE6E9EE),
    surfaceBright: Color(0xFFFFFFFF),
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFFAFBFC),
    surfaceContainer: Color(0xFFF6F7F9),
    surfaceContainerHigh: Color(0xFFF1F3F6),
    surfaceContainerHighest: Color(0xFFEDEFF3),
    onSurfaceVariant: Color(0xFF5A6472),
    outline: Color(0xFFB9C0CB),
    outlineVariant: Color(0xFFE3E6EB),
    inverseSurface: Color(0xFF1E242D),
    onInverseSurface: Color(0xFFF4F6F8),
    inversePrimary: Color(0xFFA9C4E4),
    scrim: Color(0xFF000000),
    shadow: Color(0xFF000000),
    surfaceTint: AppColors.primary,
  );

  static const ColorScheme _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: AppColors.primaryDark,
    onPrimary: Color(0xFF0B2444),
    primaryContainer: Color(0xFF1B3E63),
    onPrimaryContainer: Color(0xFFD6E4F5),
    secondary: Color(0xFFB9C2D0),
    onSecondary: Color(0xFF242C38),
    secondaryContainer: Color(0xFF333C4A),
    onSecondaryContainer: Color(0xFFDCE2EB),
    tertiary: AppColors.accentDark,
    onTertiary: Color(0xFF4A1A08),
    tertiaryContainer: Color(0xFF6B2C15),
    onTertiaryContainer: Color(0xFFFFDCCB),
    error: Color(0xFFE07A6B),
    onError: Color(0xFF4A0F09),
    errorContainer: Color(0xFF6E1E16),
    onErrorContainer: Color(0xFFFBD9D4),
    surface: Color(0xFF12161C),
    onSurface: Color(0xFFE7EAEF),
    surfaceDim: Color(0xFF0D1116),
    surfaceBright: Color(0xFF2A303A),
    surfaceContainerLowest: Color(0xFF0D1116),
    surfaceContainerLow: Color(0xFF161A21),
    surfaceContainer: Color(0xFF1A1F27),
    surfaceContainerHigh: Color(0xFF1F242D),
    surfaceContainerHighest: Color(0xFF252B34),
    onSurfaceVariant: Color(0xFFA8B1BE),
    outline: Color(0xFF6B7482),
    outlineVariant: Color(0xFF333A44),
    inverseSurface: Color(0xFFE7EAEF),
    onInverseSurface: Color(0xFF1A1F27),
    inversePrimary: AppColors.primary,
    scrim: Color(0xFF000000),
    shadow: Color(0xFF000000),
    surfaceTint: AppColors.primaryDark,
  );

  static ThemeData light() => _base(_lightScheme);

  static ThemeData dark() => _base(_darkScheme);

  static ThemeData _base(ColorScheme colorScheme) {
    final isLight = colorScheme.brightness == Brightness.light;
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      // رمادي بارد مقصود — الكريمي رجع أصول حملة تحت brand/ وبس (ADR-0093 §3): شاشة المنتج
      // المحايدة هي اللي بتخلي صور الخدمات والفنيين تبان بلونها الحقيقي.
      scaffoldBackgroundColor: isLight
          ? const Color(0xFFF3F5F8)
          : const Color(0xFF0F1318),
      cardTheme: CardThemeData(
        elevation: 1,
        color: colorScheme.surface,
        shadowColor: colorScheme.shadow.withValues(
          alpha: isLight ? 0.08 : 0.28,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.62),
          ),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: isLight ? Colors.white : colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 2,
        shadowColor: colorScheme.shadow.withValues(alpha: 0.08),
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        toolbarHeight: 72,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        filled: true,
        fillColor: isLight ? Colors.white : colorScheme.surfaceContainerHigh,
      ),
      // الشريط السفلي كان بياخد صبغة من الـscheme المولّدة، فبقى شريط وردي تحت كل شاشة.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isLight ? Colors.white : colorScheme.surface,
        indicatorColor: colorScheme.primaryContainer,
        surfaceTintColor: Colors.transparent,
        elevation: 3,
        shadowColor: colorScheme.shadow.withValues(
          alpha: isLight ? 0.10 : 0.32,
        ),
        indicatorShape: const StadiumBorder(),
        iconTheme: WidgetStateProperty.resolveWith<IconThemeData?>((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected
                ? colorScheme.primary
                : colorScheme.onSurfaceVariant,
            size: selected ? 24 : 22,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith<TextStyle?>((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected
                ? colorScheme.primary
                : colorScheme.onSurfaceVariant,
          );
        }),
      ),
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant,
        thickness: 1,
      ),
    );
  }
}

/// ألوان دلالية جاهزة حسب الثيم الحالي (فاتح/غامق) — استخدمها بدل تكرار Color(0xFF...) في كل شاشة.
extension SemanticColors on BuildContext {
  Color get successColor => Theme.of(this).brightness == Brightness.light
      ? AppColors.success
      : AppColors.successDark;
  Color get warningColor => Theme.of(this).brightness == Brightness.light
      ? AppColors.warning
      : AppColors.warningDark;
  Color get infoColor => Theme.of(this).brightness == Brightness.light
      ? AppColors.info
      : AppColors.infoDark;
  Color get dangerColor => Theme.of(this).colorScheme.error;

  /// لمسة العلامة النحاسية — اقرا قايمة الاستخدام المقفولة على `AppColors.accent` قبل ما
  /// تستعملها في مكان جديد.
  Color get accentColor => Theme.of(this).brightness == Brightness.light
      ? AppColors.accent
      : AppColors.accentDark;

  /// خلفية هادية لشريحة حالة — نص ملوّن على تظليل ~١٠٪، مش مساحة مصمتة (ADR-0093 §5).
  Color tintOf(Color color) => color.withValues(alpha: 0.10);
}

/// حقل نص جوّه **سطح بيرسم نفسه** (شريط بحث الـhero فوق الصورة، حقل البحث جوّه AppBar).
///
/// **بَقّة حقيقية من المالك (docs/08 §78-أ، لقطة وضع داكن)**: «الشريط الأسود اللي جوه محرك
/// البحث… لما الموبايل يبقى على الوضع الداكن». السبب مش في شريط البحث نفسه: `AppTheme._base`
/// بيحطّ `inputDecorationTheme(filled: true)` بـ`fillColor` غامق في الوضع الداكن، و`TextField`
/// بيورّث ده تلقائيًا حتى لو الحدود متشالة (`InputBorder.none` بتشيل الإطار **مش** التعبئة).
/// فالنتيجة مستطيل غامق مرسوم جوّه الكبسولة البيضا — غير مرئي في الوضع الفاتح لأن الـfillColor
/// هناك أبيض بالصدفة، وده اللي خلّاه يعدّي.
///
/// الحل من الجذر مش لون تاني: أي حقل بيرسم خلفيته بنفسه لازم **يلغي** التعبئة الموروثة صراحةً.
/// ثابت واحد مشترك بدل ما كل موقع يفتكر لوحده — والاختبار في `home_redesign_test.dart` بيقيس
/// الـdecoration المحسوبة فعلاً بعد تطبيق الثيم، مش النية.
const InputDecoration kSelfPaintedFieldDecoration = InputDecoration(
  filled: false,
  isDense: true,
  contentPadding: EdgeInsets.zero,
  border: InputBorder.none,
  enabledBorder: InputBorder.none,
  focusedBorder: InputBorder.none,
);
