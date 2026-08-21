import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'notification_preferences_screen.dart';
import 'notifications_repository.dart';

// صندوق إشعارات داخل التطبيق (docs/08) — كانت فجوة موثّقة صراحة: GET/PATCH /notifications/*
// كانت شغالة ومختبرة في الباك-إند من زمان (مختلفة عن push — مفيش اعتماد على FCM أو أذونات
// النظام)، بس مفيش شاشة كانت بتستخدمها. نفس الشاشة موجودة في apps/customer-app بالحرف —
// كود Dart مستقل لكل تطبيق (مفيش package Flutter مشترك بين التطبيقين في المونوريبو ده).
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final NotificationsRepository _repository;
  List<AppNotification>? _notifications;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = NotificationsRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await _repository.list();
      if (mounted) setState(() => _notifications = items);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _tap(AppNotification notification) async {
    if (notification.isUnread) {
      try {
        await _repository.markRead(notification.id);
        await _load();
      } on ApiException catch (err) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    }
  }

  Future<void> _markAllRead() async {
    try {
      await _repository.markAllRead();
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _notifications?.any((n) => n.isUnread) ?? false;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الإشعارات'),
          actions: [
            if (hasUnread) TextButton(onPressed: _markAllRead, child: const Text('تعليم الكل كمقروء')),
            IconButton(
              icon: const Icon(Icons.tune),
              tooltip: 'تفضيلات الإشعارات',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NotificationPreferencesScreen()),
              ),
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _notifications == null
              ? (_error != null ? Center(child: Text(_error!)) : const Padding(padding: EdgeInsets.all(16), child: LoadingList()))
              : _notifications!.isEmpty
                  ? ListView(
                      children: const [
                        SizedBox(height: 80),
                        EmptyState(icon: Icons.notifications_none_outlined, title: 'مفيش إشعارات لسه'),
                      ],
                    )
                  : ListView.separated(
                      itemCount: _notifications!.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final notification = _notifications![index];
                        return ListTile(
                          onTap: () => _tap(notification),
                          tileColor: notification.isUnread
                              ? Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3)
                              : null,
                          leading: Icon(
                            notification.isUnread ? Icons.circle : Icons.circle_outlined,
                            size: 12,
                            color: notification.isUnread ? Theme.of(context).colorScheme.primary : Colors.grey,
                          ),
                          title: Text(
                            notification.titleAr,
                            style: TextStyle(fontWeight: notification.isUnread ? FontWeight.bold : FontWeight.normal),
                          ),
                          subtitle: Text(notification.bodyAr),
                          trailing: Text(
                            notification.createdAt.substring(0, 10),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        );
                      },
                    ),
        ),
      ),
    );
  }
}
