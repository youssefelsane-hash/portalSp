import 'package:flutter/material.dart';

/// شاشة الانتظار الوحيدة في تطبيق الفني — بهوية البراند، مش `Scaffold` فاضي بعجلة.
///
/// نفس علاج بلاغ المالك (2026-09-10) في تطبيق العميل: كل إطار انتظار بين شاشتين مُبرندتين
/// كان بيرجع لخلفية الثيم الافتراضية بلا أي هوية، والوميض ده بيتقري كـ«بيكسلات مش مظبوطة».
/// تطبيق الفني مافيهوش لوجو من الباك-إند (مافيش استهلاك لـ`/branding` هنا)، فالعلامة مرسومة
/// بالكود — صفر أصول، وصفر نداءات شبكة على مسار الإقلاع.
class BrandedLoadingScreen extends StatelessWidget {
  const BrandedLoadingScreen({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
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
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.6, color: scheme.primary),
            ),
            if (message != null) ...[
              const SizedBox(height: 14),
              Text(
                message!,
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
