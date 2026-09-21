import 'package:flutter/material.dart';

/// **شارات سياق الطلب للفني** (بلاغ مالك 2026-09-21).
///
/// > «جوه الطلبات المتكررة تضيف للصنايعي هنت كده فوق صغيرة… كلمة متكرر بس. ولما يكون الطلب
/// > ده جاي من ضمان، يعني الكاستمر دخل أثناء فترة الضمان وعمل للصنايعي ييجي تاني، يبقى برضه
/// > هنت صغيرة كده مكتوب له جوه الطلب إن ده ضمان.»
///
/// **ليه ملف مشترك مش ويدجت جوّه كل شاشة**: الشارتين بيظهروا في مكانين (كارت قايمة الطلبات
/// وشاشة تنفيذ الطلب)، ونسختين من نفس الشكل معناها إن تغيير اللون أو النص يوم هيتعمل في واحدة
/// ويتنسى في التانية. الشكل نفسه مأخوذ من `_NewBadge` الموجود أصلاً في
/// `available_orders_screen.dart` عشان الشارات كلها تبان عيلة واحدة.
///
/// **مصدر القرار**: `Order.orderType` — `order_type` من الباك-إند بالحرف. مفيش أي استنتاج
/// محلي: `RecurringOrdersService` بيحط `recurring` على كل تكرار متولّد، و
/// `order-creation.service.ts` بيفرض `revisit` على أي طلب له `original_order_id` (إعادة زيارة
/// تحت الضمان).
class OrderContextBadge extends StatelessWidget {
  const OrderContextBadge({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
  });

  /// شارة الطلب المتكرر.
  factory OrderContextBadge.recurring() => const OrderContextBadge(
    label: 'متكرر',
    icon: Icons.repeat_rounded,
    color: Color(0xFF6D4AA6),
  );

  /// شارة إعادة الزيارة تحت الضمان.
  factory OrderContextBadge.warranty() => const OrderContextBadge(
    label: 'ضمان',
    icon: Icons.verified_user_outlined,
    color: Color(0xFF1E7A5A),
  );

  final String label;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// الشارات المنطبقة على طلب معيّن، جاهزة للحطّ في `Row`/`Wrap`.
///
/// بترجع قايمة فاضية للطلب العادي — الكولر بيستخدم `if (badges.isNotEmpty)` فمفيش مسافة
/// فاضية بتتحجز لطلب مالوش شارات.
List<Widget> orderContextBadges({
  required bool isRecurring,
  required bool isWarrantyRevisit,
}) => [
  if (isRecurring) OrderContextBadge.recurring(),
  if (isWarrantyRevisit) OrderContextBadge.warranty(),
];
