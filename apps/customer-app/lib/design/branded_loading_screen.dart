import 'package:flutter/material.dart';

import '../core/api_config.dart';
import '../features/catalog/branding_repository.dart';

/// شاشة الانتظار الوحيدة في التطبيق — بهوية البراند، مش `Scaffold` فاضي بعجلة.
///
/// **بلاغ مالك (2026-09-10)**: «لما تدخل الـOTP وتدوس تمام، بيدخلك على طول، بس فيه نص ثانية
/// تحس إن خلفية التحميل فيها بيكسلات مش مظبوطة».
///
/// السبب كان اتنين مع بعض:
///
/// ١. **بوابة الدخول كانت `Scaffold(body: Center(CircularProgressIndicator()))` عريان** — يعني
///    بين شاشة الدخول المُبرندة والقشرة المُبرندة فيه إطار واحد بخلفية الثيم الافتراضية بلا أي
///    هوية. الوميض ده هو «البيكسلات المش مظبوطة».
///
/// ٢. **اللوجو كان بيتجاب من الشبكة كل مرة من الأول**، فالعين بتشوف البديل المرسوم بالكود
///    (دايرة زرقا) الأول وبعدين يتبدّل باللوجو الحقيقي (أصفر/أسود) — تبديل مفاجئ بلا تدرّج.
///    `BrandingRepository` بقى بيكاش النتيجة لعمر العملية، والصورة بتظهر بتلاشي مش بقفزة.
class BrandedLoadingScreen extends StatefulWidget {
  const BrandedLoadingScreen({super.key, this.message});

  /// نص اختياري تحت المؤشر («بنجهّز حسابك…») — بيخلّي نص الثانية دي مفهومة بدل ما تبقى فراغ.
  final String? message;

  @override
  State<BrandedLoadingScreen> createState() => _BrandedLoadingScreenState();
}

class _BrandedLoadingScreenState extends State<BrandedLoadingScreen> {
  String? _logoUrl;

  @override
  void initState() {
    super.initState();
    // الكاش بيخلّي ده فوري بعد أول نداء في عمر التطبيق، فمفيش تبديل مرئي.
    BrandingRepository()
        .fetchPrimaryLogo()
        .then((logo) {
          if (!mounted || logo == null || logo.isDefault || logo.url.isEmpty) return;
          setState(() => _logoUrl = resolveApiAssetUrl(logo.url));
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final logoUrl = _logoUrl;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // ارتفاع ثابت: من غيره ظهور اللوجو بيزحزح كل اللي تحته — وده بالظبط الإحساس
            // بـ«حاجة بتترعش» اللي المالك وصفه.
            SizedBox(
              height: 96,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 220),
                child: logoUrl != null
                    ? Image.network(
                        logoUrl,
                        key: ValueKey(logoUrl),
                        height: 96,
                        fit: BoxFit.contain,
                        gaplessPlayback: true,
                        errorBuilder: (_, _, _) => const _BrandFallbackMark(),
                      )
                    : const _BrandFallbackMark(),
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.6, color: theme.colorScheme.primary),
            ),
            if (widget.message != null) ...[
              const SizedBox(height: 14),
              Text(
                widget.message!,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// البديل المرسوم بالكود — صفر أصول مطلوبة، فبيشتغل حتى لو الباك-إند مش شغّال خالص.
class _BrandFallbackMark extends StatelessWidget {
  const _BrandFallbackMark();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [scheme.primary, scheme.primaryContainer],
        ),
      ),
      child: Icon(Icons.handyman_rounded, size: 46, color: scheme.onPrimary),
    );
  }
}
