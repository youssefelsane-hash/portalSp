import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../design/app_theme.dart';

/// معلومات الثقة القادمة من السيرفر (`GET /trust-info`، docs/08 §75-ج).
class TrustInfo {
  const TrustInfo({required this.warrantyDays, required this.warrantyLabelAr});

  final int warrantyDays;
  final String warrantyLabelAr;

  factory TrustInfo.fromJson(Map<String, dynamic> json) => TrustInfo(
        warrantyDays: (json['warranty_days'] as num?)?.toInt() ?? 0,
        warrantyLabelAr: json['warranty_label_ar'] as String? ?? 'ضمان على الشغل',
      );
}

/// بيجيب معلومات الثقة. **الفشل بيرجّع `null` مش بيرمي** — شريط تسويقي ما ينفعش يكسر الشاشة.
Future<TrustInfo?> fetchTrustInfo() async {
  try {
    final data = await apiRequest('GET', '/trust-info');
    return data == null ? null : TrustInfo.fromJson(data);
  } catch (_) {
    return null;
  }
}

/// شريط الثقة تحت الخدمات (docs/08 §75-ج).
///
/// **طلب المالك**: «نقطة الضمان عايزين نخليها واضحة… ومش بس ضمان 14 يوم، إنت عارف إيه اللي
/// المشروع بيقدمه فعليًا… ما يبقاش الموضوع مبهرج، عايز كل حاجة سيمبل».
///
/// فالشريط ده تلات وعود **كلها حقيقية ومنفّذة في النظام**، مش شعارات:
///  - **الضمان**: النص بيجي من `/trust-info` اللي بيقرا `warranty.default_days` وأطول
///    `services.warranty_days` نشط. لو الإدارة رفعته لسنة، النص بيتغيّر لوحده.
///  - **السعر قبل ما يبدأ**: محرك التسعير بيعرض التفصيل الكامل قبل التأكيد (ADR-0044 وما قبله).
///  - **فنيين متحقّقين**: مسار اعتماد فعلي بأوراق + رقم قومي (ADR-0045).
///
/// **لو `/trust-info` ما ردّش**: بند الضمان بيتشال بالكامل بدل ما يتعرض رقم افتراضي. وعد
/// بيتقال بلا تأكيد أسوأ من وعد ما اتقالش.
class TrustStrip extends StatelessWidget {
  const TrustStrip({super.key, required this.warranty});

  final TrustInfo? warranty;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = <(IconData, String, Color)>[
      if (warranty != null) (Icons.verified_user_outlined, warranty!.warrantyLabelAr, AppColors.success),
      (Icons.receipt_long_outlined, 'السعر واضح قبل ما الشغل يبدأ', AppColors.primary),
      (Icons.badge_outlined, 'فنيين متحقّق من هويتهم', AppColors.info),
    ];

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            Row(
              children: [
                Icon(items[i].$1, size: 20, color: items[i].$3),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    items[i].$2,
                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
