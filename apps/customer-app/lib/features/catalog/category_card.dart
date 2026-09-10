import 'package:flutter/material.dart';
import '../../design/network_image_box.dart';
import 'models.dart';

// Script 6 Part 1-2 — كارت فئة موحّد (كانت مكررة نص مركزي بلا صورة في home_screen.dart
// وcategories_screen.dart، نفس الكود بالحرف). دلوقتي صورة حقيقية (cover_image_url ثم icon_url
// ثم placeholder — NetworkImageBox) فوق، اسم الفئة تحت — استلهام هيكلي من كروت Angi/Thumbtack
// (صورة + عنوان، بلا نسخ شعار/نص/تصميم فعلي)، بهوية أسطى (ألوان الـTheme الحالي).
class CategoryCard extends StatelessWidget {
  final ServiceCategory category;
  final VoidCallback onTap;

  const CategoryCard({super.key, required this.category, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            NetworkImageBox(
              imageUrl: category.cardImageUrl,
              placeholderIcon: Icons.category_outlined,
              borderRadius: BorderRadius.zero,
            ),
            // **Flexible مقصود**: خلية الشبكة ارتفاعها ثابت (مشتق من `childAspectRatio`)،
            // والصورة بتاخد ٣/٤ العرض منه. الباقي مش دايمًا بيكفي تلات سطور اسم على شاشة
            // ٣٢٠ بكسل — من غير الحد ده العمود بيتجاوز بـ٢٠–٤٠ بكسل (بَقّة بيكسل حقيقية
            // اتلقطت في مسح الشاشات). Flexible بيقصّ النص بدل ما يكسر التخطيط.
            Flexible(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                child: Text(
                  category.nameAr,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
