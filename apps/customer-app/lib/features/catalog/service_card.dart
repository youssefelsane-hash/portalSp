import 'package:flutter/material.dart';
import '../../design/network_image_box.dart';
import 'models.dart';

/// نسبة الصورة العريضة القصيرة في كارت الخدمة (docs/08 §72، بلاغ مالك: «الصورة تبقى فوق بالعرض
/// كله… صورة كنزة، مش صورة كبيرة»). 3:1 = شريط عريض واطي بيدي إحساس بالخدمة من غير ما ياكل
/// الشاشة ولا يزاحم الكلام.
const double _kServiceBannerAspectRatio = 3 / 1;

/// كارت خدمة واحد في الكتالوج (قايمة فئة أو نتايج بحث).
///
/// **ليه الشكل ده؟** الكارت كان `ListTile` بصورة 56×56 على الجنب، فالعنوان والوصف كانوا محصورين
/// في عمود ضيّق بين الصورة والسعر — أي عنوان طويع (زي «تأسيس كهرباء كامل لشقة سكنية») كان بيتلف
/// على 4-5 أسطر مكسورة، والوصف يختفي عمليًا. بلاغ المالك بالحرف: «الكلام كله متركز… الكلام مش
/// متاخد بالطول».
///
/// دلوقتي: صورة عريضة فوق ⇒ العنوان والوصف بياخدوا **عرض الكارت كله**، والسعر في سطر مستقل تحت.
/// يعني الكارت بيستوعب وصف حقيقي بدل ما ينضغط.
class ServiceCard extends StatelessWidget {
  const ServiceCard({super.key, required this.service, required this.onTap, required this.priceLabel});

  final CatalogService service;
  final VoidCallback onTap;

  /// نص السعر جاهز — الشاشة هي اللي بتقرر (سعر ثابت أو «يُحسب حسب التفاصيل»)، مش الكارت.
  final String priceLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final description = service.shortDescriptionAr?.trim();

    return Card(
      clipBehavior: Clip.antiAlias, // الصورة لازم تتقص على حواف الكارت المدوّرة
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        child: Column(
          // بلا `min` الكارت بيتمدّد لكل الارتفاع المتاح لما يتحط في مساحة بارتفاع محدود (مش
          // ListView) — اتلقطت بالقياس الفعلي: كارت 568px لمحتوى 350px.
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            NetworkImageBox(
              imageUrl: service.iconUrl,
              placeholderIcon: Icons.build_outlined,
              aspectRatio: _kServiceBannerAspectRatio,
              // الصورة ملزوقة في حواف الكارت من فوق، فمالهاش حواف مدوّرة خاصة بيها.
              borderRadius: BorderRadius.zero,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    service.nameAr,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (description != null && description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      description,
                      // 3 أسطر: مساحة حقيقية لوصف مكتوب، وبرضه سقف يمنع كارت يطول بلا نهاية.
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          priceLabel,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: theme.colorScheme.primary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(Icons.chevron_left, size: 20, color: theme.colorScheme.onSurfaceVariant),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
