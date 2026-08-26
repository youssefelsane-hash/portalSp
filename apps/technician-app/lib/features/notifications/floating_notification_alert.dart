import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/auth_repository.dart';
import '../../core/deep_link_router.dart';
import 'notifications_repository.dart';
import 'notifications_screen.dart';

class FloatingNotificationAlert extends StatefulWidget {
  const FloatingNotificationAlert({super.key});

  @override
  State<FloatingNotificationAlert> createState() => _FloatingNotificationAlertState();
}

class _FloatingNotificationAlertState extends State<FloatingNotificationAlert> with WidgetsBindingObserver {
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
      if (mounted && count != _unreadCount) setState(() => _unreadCount = count);
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
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
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
    return IgnorePointer(
      ignoring: _unreadCount == 0,
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
            heroTag: 'global-unread-notifications',
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

/// بيركّب [FloatingNotificationAlert] جوّه `Overlay` خاص بيها.
///
/// **ليه ده موجود** (بلاغ مالك 2026-08-25، docs/08 §58 و§59): الويدجت دي بتتركّب من
/// `MaterialApp.builder` جنب `child`، يعني **بره الـNavigator** بتاع التطبيق — فمفيش `Overlay`
/// فوقها في الشجرة خالص. أي حاجة جوّاها بتحتاج Overlay (`Tooltip`، `SnackBar`، `DropdownMenu`،
/// أي `Overlay.of(context)`) بترمي استثناء وقت البناء، وFlutter بيرسم `ErrorWidget` مكانها —
/// مستطيل أحمر داكن (~94% عتامة) بيغطي الشاشة. ده كان بالظبط اللي حصل مع `tooltip:` على الزرار.
///
/// شيل الـ`tooltip` حلّ الحالة دي **وحدها**. الغلاف ده بيقفل **الفئة كلها**: أي ويدجت تتضاف هنا
/// بعدين وتحتاج Overlay هتلاقي واحد جاهز بدل ما ترجّع الشاشة الحمرا تاني.
///
/// `alwaysSizeToContent: true` عشان الـOverlay ياخد مقاس الزرار نفسه بدل ما يطلب قيود محدودة
/// (إحنا جوّه `PositionedDirectional` بإزاحتين بس، يعني القيود غير محدودة) — كده الشكل والمكان
/// ما بيتغيروش ولا بكسل. و`Clip.none` عشان الـovershoot بتاع أنيميشن الدخول (easeOutBack)
/// يفضل بيترسم زي ما هو من غير قص.
class FloatingNotificationAlertHost extends StatelessWidget {
  const FloatingNotificationAlertHost({super.key});

  @override
  Widget build(BuildContext context) {
    return Overlay.wrap(
      alwaysSizeToContent: true,
      clipBehavior: Clip.none,
      child: const FloatingNotificationAlert(),
    );
  }
}
