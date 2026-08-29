import 'order.dart';

/// يحافظ على أحدث نسخة من الطلب النشط في أول القائمة من غير تكرار نفس الطلب.
List<Order> rememberActiveOrder(List<Order>? current, Order order) => [
  order,
  ...(current ?? const <Order>[]).where((item) => item.id != order.id),
];

/// الطلب الذي بدأ تنفيذه ينتمي لقسم "الشغل الحالي" فقط، حتى لو كان له تاريخ مجدول.
List<Order> excludeActiveOrders(List<Order>? upcoming, List<Order>? active) {
  final activeIds = (active ?? const <Order>[])
      .map((order) => order.id)
      .toSet();
  return (upcoming ?? const <Order>[])
      .where((order) => !activeIds.contains(order.id))
      .toList(growable: false);
}
