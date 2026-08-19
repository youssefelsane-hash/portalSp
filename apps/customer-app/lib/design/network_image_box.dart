import 'package:flutter/material.dart';

// Script 6 Part 1-2 — "central aspect-ratio standards, placeholders, error fallbacks" لكروت
// الفئات/الخدمات. نسبة عرض واحدة موحّدة لكل كروت الكتالوج (4:3 — قريبة من نسب كروت Angi/
// Thumbtack المرجعية هيكليًا فقط، من غير نسخ شعار/نص/تصميم فعلي). أي شاشة كتالوج جديدة تستخدم
// نفس الثابت بدل ما تخترع نسبة عشوائية لنفسها.
const double kCatalogCardAspectRatio = 4 / 3;

// صندوق صورة عام بأبعاد ثابتة (aspect ratio) لكروت الكتالوج — بديل موحّد عن استخدام
// Image.network مباشرة في كل شاشة. ثلاث حالات: صورة null/فاضية → placeholder فورًا (بلا محاولة
// تحميل)، تحميل جاري → نفس الـplaceholder (بدل شاشة فاضية تومض)، فشل تحميل فعلي (404/شبكة) →
// نفس الـplaceholder عبر errorBuilder — أبدًا أيقونة كسر الصورة الافتراضية لـFlutter.
class NetworkImageBox extends StatelessWidget {
  final String? imageUrl;
  final IconData placeholderIcon;
  final double aspectRatio;
  final BorderRadius borderRadius;

  const NetworkImageBox({
    super.key,
    required this.imageUrl,
    this.placeholderIcon = Icons.image_outlined,
    this.aspectRatio = kCatalogCardAspectRatio,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
  });

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    return AspectRatio(
      aspectRatio: aspectRatio,
      child: ClipRRect(
        borderRadius: borderRadius,
        child: url == null || url.isEmpty
            ? _placeholder(context)
            : Image.network(
                url,
                fit: BoxFit.cover,
                width: double.infinity,
                height: double.infinity,
                errorBuilder: (context, error, stackTrace) => _placeholder(context),
                loadingBuilder: (context, child, progress) => progress == null ? child : _placeholder(context),
              ),
      ),
    );
  }

  Widget _placeholder(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      color: scheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(placeholderIcon, size: 32, color: scheme.onSurfaceVariant),
    );
  }
}
