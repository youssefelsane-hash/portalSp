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
          child: FloatingActionButton.small(
            heroTag: 'global-unread-notifications',
            onPressed: _openNotifications,
            tooltip: 'رسائل وإشعارات جديدة',
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
