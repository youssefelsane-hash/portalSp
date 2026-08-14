import 'package:flutter/material.dart';
import '../features/orders/order_detail_screen.dart';

// docs/08 §19 بند 11 — مسؤول عن الملاحة الفعلية لما العميل يضغط على إشعار push (سواء التطبيق كان
// في الخلفية أو مقفول تمامًا). محدود عمدًا على أنماط الـdeep_link الحقيقية اللي الباك-إند بيبعتها
// فعلاً للعميل (grep -rn "deepLink:" apps/api/src/modules/notifications — كلها /orders/:id أو
// /orders/:id/select-technician، والاتنين بيروحوا لنفس الشاشة لأن OrderDetailScreen نفسها بتعرض
// قسم "اختيار فني بديل" لما order_status==awaiting_technician_reselection).
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

final RegExp _orderDeepLinkPattern = RegExp(r'^/orders/([0-9a-fA-F-]+)');

void handleDeepLink(String? deepLink) {
  if (deepLink == null || deepLink.isEmpty) return;
  final navigator = rootNavigatorKey.currentState;
  if (navigator == null) return;

  final match = _orderDeepLinkPattern.firstMatch(deepLink);
  if (match == null) return;
  final orderId = match.group(1)!;
  navigator.push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: orderId)));
}
