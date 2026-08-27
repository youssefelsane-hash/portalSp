import 'package:flutter/material.dart';

import 'models.dart';

/// أبعاد صف «الأكثر طلبًا» — معرّفة هنا عشان الصف اللي بيحجز الارتفاع والخانة نفسها يتفقوا
/// على **نفس الأرقام**، مش رقم مكتوب في مكانين وبيفترقوا مع أول تعديل.
const double _kFeaturedIconSize = 44;
const double _kFeaturedLabelGap = 6;
const double _kFeaturedLabelFontSize = 12;
const double _kFeaturedLabelLineHeight = 1.35;

/// ارتفاع صف «الأكثر طلبًا» — **محسوب من مقياس خط المستخدم الفعلي، مش رقم ثابت**.
///
/// نفس درس `categoryTileLabelHeight` بالحرف (docs/08 §75-ب): الصف بيتحط جوّه
/// `SizedBox(height:)` عشان `ListView` أفقي لازم يعرف ارتفاعه. رقم ثابت هنا معناه إن أول
/// مستخدم يكبّر خط النظام يشوف شريط overflow أصفر/أسود في نص شاشته الرئيسية — وده بالظبط
/// نوع البَقّة اللي المالك بلّغ عنها في اللوحة فوق.
double featuredRowHeight(BuildContext context) {
  final scaler = MediaQuery.textScalerOf(context);
  return _kFeaturedIconSize +
      _kFeaturedLabelGap +
      scaler.scale(_kFeaturedLabelFontSize) * _kFeaturedLabelLineHeight;
}

/// «الأكثر طلبًا» — الأيقونة سايبة على الصفحة، بلا أي إطار ولا خلفية.
///
/// **بلاغ مالك صريح (docs/08 §76-د)**: «اللوجو اللي جوّاه الأكثر طلبًا موجود حواليه إطار لونه
/// رمادي مختلف عن لون الصفحة — أنا عايز اللوجو بس وفي الصفحة طاير كده». اللي كان موجود
/// `CircleAvatar` بـ`surfaceContainerHighest` كخلفية: دايرة رمادية واضحة ورا كل أيقونة.
///
/// شيلنا الدايرة بالكامل. **الاستثناء المقصود**: لما مفيش `icon_url` بنرجع لحرف أول الاسم —
/// حرف عايم في الفراغ بلا أي حاوية بيبقى ضايع بصريًا ومش باين إنه زرار، فبيفضل ليه دايرة
/// خفيفة بلون الهوية. يعني الدايرة بقت **شبكة أمان لحالة الغياب**، مش الشكل الافتراضي.
class FeaturedCategoryItem extends StatelessWidget {
  final ServiceCategory category;
  final VoidCallback onTap;

  const FeaturedCategoryItem({required this.category, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final iconUrl = category.iconUrl;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 72,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: _kFeaturedIconSize,
              child: iconUrl != null && iconUrl.isNotEmpty
                  ? Image.network(
                      iconUrl,
                      fit: BoxFit.contain,
                      errorBuilder: (context, error, stackTrace) =>
                          _FeaturedInitial(category: category),
                    )
                  : _FeaturedInitial(category: category),
            ),
            const SizedBox(height: _kFeaturedLabelGap),
            Flexible(
              child: Text(
                category.nameAr,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontSize: _kFeaturedLabelFontSize,
                      height: _kFeaturedLabelLineHeight,
                      fontWeight: FontWeight.w500,
                      color: scheme.onSurface,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// حرف أول اسم الفئة — بديل الأيقونة الغايبة (شوف تعليق `FeaturedCategoryItem`).
class _FeaturedInitial extends StatelessWidget {
  const _FeaturedInitial({required this.category});

  final ServiceCategory category;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: 0.1),
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          category.nameAr.characters.first,
          style: TextStyle(
            color: scheme.primary,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
    );
  }
}
