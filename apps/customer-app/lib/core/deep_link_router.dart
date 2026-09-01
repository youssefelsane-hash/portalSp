import 'package:flutter/material.dart';
import '../features/chat/chat_screen.dart';
import '../features/orders/order_detail_screen.dart';
import '../features/support/complaint_detail_screen.dart';
import '../features/warranty/warranties_screen.dart';

// docs/08 §19 بند 11 — مسؤول عن الملاحة الفعلية لما العميل يضغط على إشعار push (سواء التطبيق كان
// في الخلفية أو مقفول تمامًا). محدود عمدًا على أنماط الـdeep_link الحقيقية اللي الباك-إند بيبعتها
// فعلاً للعميل (grep -rn "deepLink:" apps/api/src/modules/notifications — كلها /orders/:id أو
// /orders/:id/select-technician، والاتنين بيروحوا لنفس الشاشة لأن OrderDetailScreen نفسها بتعرض
// قسم "اختيار فني بديل" لما order_status==awaiting_technician_reselection). /complaints/:id اتضاف
// (docs/08 §73 بند 2) لإشعارات رد/تحديث حالة الشكوى — كان بيسقط بصمت (handleDeepLink بترجع من
// غير أي ملاحة) قبل كده. `/warranties` يفتح ضماناتي من تحديثات مطالبة الضمان الإدارية.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

final RegExp _orderDeepLinkPattern = RegExp(r'^/orders/([0-9a-fA-F-]+)');
final RegExp _complaintDeepLinkPattern = RegExp(r'^/complaints/([0-9a-fA-F-]+)');

void handleDeepLink(String? deepLink) {
  if (deepLink == null || deepLink.isEmpty) return;
  final navigator = rootNavigatorKey.currentState;
  if (navigator == null) return;

  final orderMatch = _orderDeepLinkPattern.firstMatch(deepLink);
  if (orderMatch != null) {
    final orderId = orderMatch.group(1)!;
    if (deepLink == '/orders/$orderId/chat') {
      navigator.push(MaterialPageRoute(builder: (_) => ChatScreen(orderId: orderId)));
    } else {
      navigator.push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: orderId)));
    }
    return;
  }
  final complaintMatch = _complaintDeepLinkPattern.firstMatch(deepLink);
  if (complaintMatch != null) {
    navigator.push(MaterialPageRoute(builder: (_) => ComplaintDetailScreen(complaintId: complaintMatch.group(1)!)));
    return;
  }
  if (deepLink == '/support-chat') {
    navigator.push(MaterialPageRoute(builder: (_) => const ChatScreen.support()));
    return;
  }
  if (deepLink == '/warranties') {
    navigator.push(MaterialPageRoute(builder: (_) => const WarrantiesScreen()));
  }
}
