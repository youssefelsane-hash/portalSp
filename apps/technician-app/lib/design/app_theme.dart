import 'package:flutter/material.dart';

/// نظام التصميم المشترك (docs/12 — مرحلة تحسين UI/UX، امتداد Flutter بعد Admin Panel).
/// نفس القيم الدلالية المستخدمة في apps/admin/src/app/globals.css (أزرق ثقة احترافي + نظام
/// حالات success/warning/danger/info) — معادِلة بصريًا (Flutter Material3 بيستخدم sRGB مش OKLCH
/// زي CSS، فمفيش تطابق رقمي حرفي، بس نفس الانطباع البصري بالظبط).
class AppColors {
  AppColors._();

  static const primary = Color(0xFF2F5AA6);
  static const primaryDark = Color(0xFF7FA6E0);

  static const success = Color(0xFF3C8B4A);
  static const successDark = Color(0xFF6FBF7A);

  static const warning = Color(0xFFC98A1F);
  static const warningDark = Color(0xFFE0AC4E);

  static const info = Color(0xFF3D62A6);
  static const infoDark = Color(0xFF87A9DE);

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

  static ThemeData light() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
    );
    return _base(colorScheme);
  }

  static ThemeData dark() {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primaryDark,
      brightness: Brightness.dark,
    );
    return _base(colorScheme);
  }

  static ThemeData _base(ColorScheme colorScheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.brightness == Brightness.light
          ? const Color(0xFFF7F8FA)
          : null,
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: colorScheme.outlineVariant),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.brightness == Brightness.light
            ? Colors.white
            : null,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
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
        fillColor: colorScheme.brightness == Brightness.light
            ? Colors.white
            : colorScheme.surfaceContainerHighest,
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
}
