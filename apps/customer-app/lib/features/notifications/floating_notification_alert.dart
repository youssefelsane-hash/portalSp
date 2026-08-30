import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auth_repository.dart';
import '../../core/deep_link_router.dart';
import 'notifications_repository.dart';
import 'notifications_screen.dart';

// راصد بيتابع أي popup route (dialog/bottom sheet/menu/date-time picker) ظاهر فوق الشجرة
// (docs/08 §108-E) — بلاغ مالك: الزرار العايم للإشعارات بيتغطى/بيغطي زرار "موافق" في بعض
// الـdialogs الصغيرة، لأنه متركّب في MaterialApp.builder فوق الـNavigator كله بالكامل (نفس
// السبب اللي وراء ملاحظات الـOverlay تحت — الزرار ده برّه شجرة أي route). لازم يتسجّل في
// `navigatorObservers` بتاعة MaterialApp عشان يشتغل.
final ValueNotifier<int> _notificationAlertPopupDepth = ValueNotifier(0);

class NotificationAlertPopupObserver extends NavigatorObserver {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PopupRoute) _notificationAlertPopupDepth.value++;
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PopupRoute && _notificationAlertPopupDepth.value > 0) {
      _notificationAlertPopupDepth.value--;
    }
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (route is PopupRoute && _notificationAlertPopupDepth.value > 0) {
      _notificationAlertPopupDepth.value--;
    }
  }
}

class FloatingNotificationAlert extends StatefulWidget {
  const FloatingNotificationAlert({super.key});

  @override
  State<FloatingNotificationAlert> createState() =>
      _FloatingNotificationAlertState();
}

class _FloatingNotificationAlertState extends State<FloatingNotificationAlert>
    with WidgetsBindingObserver {
  static const _refreshInterval = Duration(seconds: 5);

  late final NotificationsRepository _repository;
  Timer? _timer;
  int _unreadCount = 0;
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _repository = NotificationsRepository(context.read<AuthRepository>());
    _startRefreshing();
  }

  void _startRefreshing() {
    _timer?.cancel();
    unawaited(_refresh());
    _timer = Timer.periodic(_refreshInterval, (_) => _refresh());
  }

  Future<void> _refresh() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      final count = await _repository.unreadCount();
      if (mounted && count != _unreadCount) {
        setState(() => _unreadCount = count);
      }
    } catch (_) {
      // Push remains the primary instant path; polling is a durable in-app fallback.
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _openNotifications() async {
    await rootNavigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => const NotificationsScreen()),
    );
    await _refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startRefreshing();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _timer?.cancel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: _notificationAlertPopupDepth,
      builder: (context, popupDepth, child) {
        // docs/08 §108-E — لو فيه dialog/bottom-sheet ظاهر، الزرار العايم بيختفي مؤقتًا بدل
        // ما يتغطى فوقه أو يغطّي زرار "موافق"/"تأكيد" بتاعه (بلاغ مالك مباشر بلقطة شاشة).
        final hiddenByPopup = popupDepth > 0;
        return IgnorePointer(
          ignoring: _unreadCount == 0 || hiddenByPopup,
          child: AnimatedOpacity(
            opacity: hiddenByPopup ? 0 : 1,
            duration: const Duration(milliseconds: 150),
            child: child,
          ),
        );
      },
      child: AnimatedScale(
        scale: _unreadCount > 0 ? 1 : 0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutBack,
        child: Semantics(
          label: '$_unreadCount إشعارات غير مقروءة',
          button: true,
          // بلاغ مالك (2026-08-25): شاشة حمرا في التطبيقين بعد اللوجن على طول. السبب إن
          // `tooltip:` بيلف الزرار في `Tooltip`، و`Tooltip` **بيحتاج `Overlay` جدّ** —
          // والويدجت دي متركّبة في `MaterialApp.builder` جنب `child`، يعني **بره الـNavigator**
          // فمفيش Overlay فوقها خالص. النتيجة استثناء وقت البناء، وFlutter بيرسم `ErrorWidget`
          // بتاعه (`RenderErrorBox` = مستطيل أحمر داكن ~94% عتامة) — دي الشاشة الحمرا نفسها.
          // بتظهر بعد اللوجن بالظبط لأن الويدجت متعلّقة على `auth.isAuthenticated` في main.dart.
          //
          // الـ`tooltip` زيادة أصلاً هنا: `Semantics(label: ...)` فوق بيوفّر نفس المعنى لقارئ
          // الشاشة، وTooltip على الموبايل بيتطلب ضغطة مطوّلة نادرًا حد بيعملها على زرار عايم.
          child: FloatingActionButton.small(
            // الزر موجود خارج Navigator، لذلك لا يجب تسجيله كبطل انتقال عالمي. إبقاء Hero هنا
            // كان يترك اعتمادًا على شجرة الانتقال عند فتح بعض الصفحات (منها ضماناتي)، وينتهي
            // بتأكيد Flutter `_dependents.isEmpty` بدل فتح الصفحة.
            heroTag: null,
            onPressed: _openNotifications,
            child: Badge(
              label: Text(_unreadCount > 99 ? '99+' : '$_unreadCount'),
              child: const Icon(Icons.mark_unread_chat_alt_outlined),
            ),
          ),
        ),
      ),
    );
  }
}

/// غلاف خفيف للزر العائم المستخدم من `MaterialApp.builder`.
///
/// لا نضيف `Overlay` أو `Hero` مستقلين هنا: الزر نفسه لا يحتاجهما، ووجود شجرة انتقال ثانية
/// خارج الـNavigator كان يسبب اعتمادًا معلقًا عند فتح صفحات مثل «ضماناتي». أي واجهة مستقبلية
/// تحتاج Overlay يجب فتحها عبر [rootNavigatorKey] مثل شاشة الإشعارات نفسها.
class FloatingNotificationAlertHost extends StatelessWidget {
  const FloatingNotificationAlertHost({super.key});

  @override
  Widget build(BuildContext context) => const FloatingNotificationAlert();
}
