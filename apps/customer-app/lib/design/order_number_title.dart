import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// عنوان شاشة الطلب — **رقم الطلب كامل، مش مقصوص** (docs/08 §77-A2).
///
/// **بلاغ مالك حقيقي بلقطة**: العنوان كان `Text('طلب ${order.orderNumber}')` جوّه `AppBar`،
/// والـ`AppBar` بيقصّ بنقط لما العنوان + أيقونات الـactions ما يوسعوش. النتيجة إن الظاهر كان
/// «طلب ORD-2026-…» — يعني الجزء المميّز من الرقم (اللي بيفرّق طلب عن طلب) هو بالظبط الجزء
/// اللي بيتشال.
///
/// ده مش عيب تجميلي: رقم الطلب هو **المُعرّف الوحيد** اللي الفني والعميل بيتكلموا بيه مع
/// الدعم. لما يتقصّ، القدرة على الإبلاغ عن الطلب بتتلغي.
///
/// **الحل مش تكبير المساحة** (مفيش مساحة زيادة في `AppBar` أصلاً مع الأيقونات) — الحل إن
/// «طلب» تنزل لسطر تسمية صغير فوق، والرقم ياخد السطر كله لوحده بخط أصغر. المالك قال بالحرف:
/// «عادي نصغره، نصغر حجمه خالص ونخليه باين كله».
///
/// **الضغط المطوّل بينسخ الرقم** — الخطوة اللي بعد «شفت الرقم» مباشرةً هي «ابعته للدعم».
class OrderNumberTitle extends StatelessWidget {
  const OrderNumberTitle({super.key, required this.orderNumber, this.fallbackLabel = 'تفاصيل الطلب'});

  /// null قبل ما الطلب يتحمّل — بيتعرض `fallbackLabel` بدل عنوان نصّه ناقص.
  final String? orderNumber;
  final String fallbackLabel;

  @override
  Widget build(BuildContext context) {
    final number = orderNumber;
    if (number == null || number.isEmpty) return Text(fallbackLabel);

    final theme = Theme.of(context);
    return GestureDetector(
      onLongPress: () async {
        await Clipboard.setData(ClipboardData(text: number));
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('اتنسخ رقم الطلب')),
        );
      },
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'طلب',
            style: theme.textTheme.labelSmall?.copyWith(
              fontSize: 11,
              height: 1.1,
              color: theme.appBarTheme.foregroundColor?.withValues(alpha: 0.75) ??
                  theme.colorScheme.onSurface.withValues(alpha: 0.75),
            ),
          ),
          Text(
            number,
            // الرقم لاتيني دايمًا (ORD-YYYY-…) — `ltr` بيمنع انعكاس الشرطات في واجهة عربية.
            textDirection: TextDirection.ltr,
            maxLines: 1,
            // `ellipsis` شبكة أمان أخيرة بس: الخط 13 بيخلّي رقم بطول 24 حرف (أقصى طول
            // `orders.order_number` في الـschema) يبان كامل على أضيق شاشة موبايل.
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleSmall?.copyWith(
              fontSize: 13,
              height: 1.15,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}
