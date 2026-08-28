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
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              child: Text(
                category.nameAr,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
