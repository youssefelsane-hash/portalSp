import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'auth_repository.dart';
import '../features/assistant_offers/assistant_offers_screen.dart';
import '../features/orders/order_execution_screen.dart';
import '../features/orders/orders_repository.dart';

// docs/08 §19 بند 11 — نفس الفجوة الموثّقة في customer-app's core/deep_link_router.dart، بس هنا
// كانت أوضح: push_notification_service.dart's _handleNotificationAction (§17.16) كان بيتعامل مع
// زراير قبول/رفض عرض الطلب بس — تعليقه القديم بيقول صراحة "مجرد تاب على جسم الإشعار (مش زرار)
// بيترك من غير فعل ... لو حبينا نضيف navigation فعلي لاحقًا". محدود على أنماط deep_link الحقيقية
// اللي الباك-إند بيبعتها للفني (grep -rn "deepLink:.*technician" apps/api/src/modules/notifications).
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

final RegExp _orderDeepLinkPattern = RegExp(r'^/technician/orders/([0-9a-fA-F-]+)');
const _assistantOffersDeepLinkPrefix = '/technician/assistant-offers';

Future<void> handleDeepLink(String? deepLink) async {
  if (deepLink == null || deepLink.isEmpty) return;
  final navigator = rootNavigatorKey.currentState;
  final context = rootNavigatorKey.currentContext;
  if (navigator == null || context == null) return;

  if (deepLink.startsWith(_assistantOffersDeepLinkPrefix)) {
    navigator.push(MaterialPageRoute(builder: (_) => const AssistantOffersScreen()));
    return;
  }

  final match = _orderDeepLinkPattern.firstMatch(deepLink);
  if (match == null) return;
  final orderId = match.group(1)!;
  try {
    final authRepository = context.read<AuthRepository>();
    final order = await OrdersRepository(authRepository).getOne(orderId);
    navigator.push(MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)));
  } catch (_) {
    // الطلب ممكن يكون خلص/اتلغى/اتاخد من فني تاني قبل ما الفني يضغط على الإشعار فعليًا —
    // تجاهل بهدوء بدل ما نكسر التطبيق بخطأ شبكة على فعل مؤجّل زمنيًا خارج تحكمنا.
  }
}
