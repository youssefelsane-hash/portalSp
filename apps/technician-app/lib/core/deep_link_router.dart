import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'auth_repository.dart';
import '../features/assistant_offers/assistant_offers_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/internal_chat/internal_chat_detail_screen.dart';
import '../features/internal_chat/internal_chat_repository.dart';
import '../features/orders/order_execution_screen.dart';
import '../features/orders/orders_repository.dart';
import '../features/support/complaint_detail_screen.dart';

// docs/08 §19 بند 11 — نفس الفجوة الموثّقة في customer-app's core/deep_link_router.dart، بس هنا
// كانت أوضح: push_notification_service.dart's _handleNotificationAction (§17.16) كان بيتعامل مع
// زراير قبول/رفض عرض الطلب بس — تعليقه القديم بيقول صراحة "مجرد تاب على جسم الإشعار (مش زرار)
// بيترك من غير فعل ... لو حبينا نضيف navigation فعلي لاحقًا". محدود على أنماط deep_link الحقيقية
// اللي الباك-إند بيبعتها للفني (grep -rn "deepLink:.*technician" apps/api/src/modules/notifications).
// /complaints/:id اتضاف (docs/08 §73 بند 2) — الفني كمان طرف في شكاوى (فني يقدر يرفع شكوى على
// عميل)، فنفس رابط الإشعار (`/complaints/:id`، بلا prefix `/technician`) بيوصله هو كمان.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

final RegExp _orderDeepLinkPattern = RegExp(r'^/technician/orders/([0-9a-fA-F-]+)');
final RegExp _internalChatDeepLinkPattern = RegExp(r'^/technician/internal-chat/([0-9a-fA-F-]+)$');
final RegExp _complaintDeepLinkPattern = RegExp(r'^/complaints/([0-9a-fA-F-]+)');
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

  final authRepository = context.read<AuthRepository>();
  final internalChatMatch = _internalChatDeepLinkPattern.firstMatch(deepLink);
  if (internalChatMatch != null) {
    try {
      final threadId = internalChatMatch.group(1)!;
      final threads = await InternalChatRepository(authRepository).fetchThreads();
      for (final thread in threads) {
        if (thread.id == threadId) {
          navigator.push(MaterialPageRoute(builder: (_) => InternalChatDetailScreen(thread: thread)));
          return;
        }
      }
    } catch (_) {
      return;
    }
  }

  final complaintMatch = _complaintDeepLinkPattern.firstMatch(deepLink);
  if (complaintMatch != null) {
    navigator.push(MaterialPageRoute(builder: (_) => ComplaintDetailScreen(complaintId: complaintMatch.group(1)!)));
    return;
  }

  final match = _orderDeepLinkPattern.firstMatch(deepLink);
  if (match == null) return;
  final orderId = match.group(1)!;
  if (deepLink == '/technician/orders/$orderId/chat') {
    navigator.push(MaterialPageRoute(builder: (_) => ChatScreen(orderId: orderId)));
    return;
  }
  try {
    final order = await OrdersRepository(authRepository).getOne(orderId);
    navigator.push(MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)));
  } catch (_) {
    // الطلب ممكن يكون خلص/اتلغى/اتاخد من فني تاني قبل ما الفني يضغط على الإشعار فعليًا —
    // تجاهل بهدوء بدل ما نكسر التطبيق بخطأ شبكة على فعل مؤجّل زمنيًا خارج تحكمنا.
  }
}
