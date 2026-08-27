import 'package:flutter/material.dart';
import '../../design/network_image_box.dart';
import 'models.dart';

/// نسبة صورة الفئة في الشبكة المدمجة — **1:1** (docs/08 §75-ب).
///
/// المرجع البصري اللي بعته المالك بيستخدم مربّع. المربّع في شبكة 3 أعمدة بيدّي صورة أوضح من
/// 4:3 (أعلى بـ33% في نفس العرض) من غير ما ياخد ارتفاع الشاشة كله، وبيخلّي صفوف الشبكة
/// متساوية بصريًا مهما كان طول أسماء الفئات.
const double _kTileImageAspectRatio = 1;

/// عرض تقريبي للخانة على شاشة موبايل عادية (~390px، 3 أعمدة، حشو 16 وفواصل 12) — بيتستخدم
/// لتحديد حجم فك ترميز الصورة. تقدير مقصود: `cacheWidth` مش لازم يكون مضبوط بالبكسل، هو بس
/// بيمنع فك صورة 2000px لخانة صغيرة.
const double _kTileDecodeWidth = 116;

/// حجم خط اسم الفئة (`labelLarge` في الثيم) وارتفاع السطر — مُعرّفين هنا عشان الشبكة اللي
/// بتحسب `childAspectRatio` والخانة نفسها يتفقوا على **نفس الرقم**.
const double _kTileLabelFontSize = 14;
const double _kTileLabelLineHeight = 1.25;
const double _kTileLabelMaxLines = 2;
const double _kTileLabelGap = 8;

/// الارتفاع اللي لازم الشبكة تحجزه لاسم الفئة تحت الصورة.
///
/// **بَقّة حقيقية اتلقطت بالاختبار (docs/08 §75-ب)**: الرقم ده كان ثابت (44px)، والشبكة
/// بتستخدم `childAspectRatio` — يعني ارتفاع الخانة محجوز مقدمًا. أول ما مستخدم يكبّر خط
/// النظام (إعداد إتاحة عادي جدًا)، اسم بسطرين كان بيعمل `RenderFlex overflowed by 10 pixels`
/// — شريط أصفر/أسود باين للمستخدم في نص الشاشة الرئيسية.
///
/// الحل مش تصغير الخط ولا قص الاسم: الارتفاع المحجوز بيتحسب من **مقياس الخط الفعلي** للمستخدم،
/// فالخط الأكبر بياخد مساحة أكبر زي ما المفروض.
double categoryTileLabelHeight(BuildContext context) {
  final scaler = MediaQuery.textScalerOf(context);
  return scaler.scale(_kTileLabelFontSize) * _kTileLabelLineHeight * _kTileLabelMaxLines +
      _kTileLabelGap;
}

/// خانة فئة مدمجة للشبكة الرئيسية — **الصورة فوق، الاسم تحتها برّه الكارت**.
///
/// **الفرق عن `CategoryCard`** (اللي لسه مستخدم في شاشة "كل الفئات" بعرض أوسع): هنا الاسم
/// **مش** جوّه كارت وسط. ده مقصود ومأخوذ من المرجع اللي بعته المالك: الاسم برّه الصورة،
/// محاذي للبداية، بخط صغير سميك. النتيجة إن العين بتقرا شبكة الصور كوحدة واحدة والأسماء
/// كطبقة تانية — أهدى بصريًا بكتير من تسعة كروت كاملة بحدود وظلال.
///
/// **سطرين للاسم**: أسماء الفئات العربية بتطول («تأسيس كهرباء كامل»)، وسطر واحد كان بيقصّها
/// بنقط. سطرين بيستوعبوا الأغلبية، والارتفاع محجوز ثابت عشان صفوف الشبكة تفضل متساوية.
class CategoryTile extends StatelessWidget {
  const CategoryTile({super.key, required this.category, required this.onTap});

  final ServiceCategory category;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          NetworkImageBox(
            imageUrl: category.cardImageUrl,
            placeholderIcon: Icons.category_outlined,
            aspectRatio: _kTileImageAspectRatio,
            borderRadius: BorderRadius.circular(14),
            decodeWidth: _kTileDecodeWidth,
          ),
          const SizedBox(height: _kTileLabelGap),
          // `Flexible` شبكة أمان تانية: لو أي حساب اتغير بعدين، الاسم بيتقص بنقط بدل ما
          // يعمل overflow باين للمستخدم.
          Flexible(
            child: Text(
              category.nameAr,
              maxLines: _kTileLabelMaxLines.toInt(),
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelLarge?.copyWith(
                fontSize: _kTileLabelFontSize,
                fontWeight: FontWeight.w600,
                height: _kTileLabelLineHeight,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
