import 'package:flutter/material.dart';

// Script 6 Part 1-2 — "central aspect-ratio standards, placeholders, error fallbacks" لكروت
// الفئات/الخدمات. نسبة عرض واحدة موحّدة لكل كروت الكتالوج (4:3 — قريبة من نسب كروت Angi/
// Thumbtack المرجعية هيكليًا فقط، من غير نسخ شعار/نص/تصميم فعلي). أي شاشة كتالوج جديدة تستخدم
// نفس الثابت بدل ما تخترع نسبة عشوائية لنفسها.
const double kCatalogCardAspectRatio = 4 / 3;

/// مدة الظهور التدريجي للصورة بعد ما تحمّل (docs/08 §75-د).
const Duration _kImageFadeDuration = Duration(milliseconds: 260);

/// صندوق صورة موحّد لكل كروت الكتالوج.
///
/// **بلاغ المالك (2026-08-27): «الصورة تقعد تختفي وتظهر، ومع الريلود تروح».** كان فيه تلات
/// أسباب حقيقية للوميض ده، كلها اتعالجت هنا:
///
/// 1. **`loadingBuilder` كان بيرجّع الـplaceholder على طول** — يعني كل مرة الودجت تتبني من
///    جديد (scroll في ListView، `setState`، رجوع من شاشة تانية) الصورة كانت بتختفي وترجع
///    تظهر فجأة. `frameBuilder` بديل أنضف: بيخلّي الإطار المعروض مكانه ويعمل ظهور تدريجي،
///    و`wasSynchronouslyLoaded` بيمنع أي أنيميشن للصور اللي جت من الكاش أصلاً (مفيش وميض
///    للصورة المحمّلة قبل كده).
/// 2. **مفيش `gaplessPlayback`** — لما الرابط يتغيّر، Flutter بيمسح الإطار القديم فورًا
///    ويسيب فراغ لحد ما الجديد يجهز. `gaplessPlayback: true` بيخلّي القديم ظاهر لحد ما
///    الجديد يبقى جاهز فعلاً ⇒ انتقال بلا فراغ أبيض.
/// 3. **مفيش تحديد لحجم فك الترميز** — صورة 2000px كانت بتتفك بحجمها الكامل في الذاكرة
///    لكارت عرضه 120px. `cacheWidth` بيقلّل الذاكرة ووقت فك الترميز بشكل كبير، وده لوحده
///    بيقلّل الفترة اللي الكارت بيفضل فيها فاضي.
///
/// الحالات التلاتة القديمة زي ما هي: رابط فاضي ⇒ placeholder فورًا بلا محاولة تحميل، تحميل
/// جاري ⇒ نفس الـplaceholder، فشل حقيقي (404/شبكة) ⇒ نفس الـplaceholder — أبدًا أيقونة كسر
/// الصورة الافتراضية.
class NetworkImageBox extends StatelessWidget {
  final String? imageUrl;
  final IconData placeholderIcon;
  final double aspectRatio;
  final BorderRadius borderRadius;

  /// العرض المنطقي التقريبي للكارت — بيتحوّل لـ`cacheWidth` بعد ضربه في كثافة الشاشة.
  /// `null` = بلا تحديد (للصور الكبيرة زي الـhero اللي بتاخد عرض الشاشة كله).
  final double? decodeWidth;

  const NetworkImageBox({
    super.key,
    required this.imageUrl,
    this.placeholderIcon = Icons.image_outlined,
    this.aspectRatio = kCatalogCardAspectRatio,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
    this.decodeWidth,
  });

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    // كثافة الشاشة لازم تدخل في الحساب — cacheWidth بالبكسل الفيزيائي مش المنطقي، ومن غير
    // الضرب ده الصورة بتطلع مهترية على شاشات 2x/3x.
    final devicePixelRatio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 1.0;
    final cacheWidth = decodeWidth == null ? null : (decodeWidth! * devicePixelRatio).round();

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
                cacheWidth: cacheWidth,
                // الإطار القديم يفضل ظاهر لحد ما الجديد يجهز — بدل فراغ أبيض بينهم.
                gaplessPlayback: true,
                errorBuilder: (context, error, stackTrace) => _placeholder(context),
                frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
                  // جت من الكاش ⇒ اعرضها فورًا بلا أي أنيميشن. أي fade هنا هيبقى وميض
                  // مصطنع لصورة كانت جاهزة أصلاً.
                  if (wasSynchronouslyLoaded) return child;
                  return AnimatedSwitcher(
                    duration: _kImageFadeDuration,
                    // Stack layout بيمنع "قفزة" الحجم أثناء التبديل بين الـplaceholder والصورة.
                    layoutBuilder: (currentChild, previousChildren) => Stack(
                      fit: StackFit.expand,
                      children: [...previousChildren, ?currentChild],
                    ),
                    child: frame == null
                        ? _placeholder(context, key: const ValueKey('placeholder'))
                        : KeyedSubtree(key: const ValueKey('image'), child: child),
                  );
                },
              ),
      ),
    );
  }

  Widget _placeholder(BuildContext context, {Key? key}) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      key: key,
      color: scheme.surfaceContainerHighest,
      alignment: Alignment.center,
      child: Icon(placeholderIcon, size: 32, color: scheme.onSurfaceVariant),
    );
  }
}
