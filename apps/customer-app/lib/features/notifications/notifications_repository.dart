import '../../core/auth_repository.dart';
import 'models.dart';

// صندوق إشعارات داخل التطبيق (docs/08) — مختلف عن push (لا يعتمد على FCM ولا أذونات النظام)،
// مفتوح لأي مستخدم مسجّل دخول في الباك-إند.
class NotificationsRepository {
  final AuthRepository auth;

  NotificationsRepository(this.auth);

  Future<List<AppNotification>> list({bool unreadOnly = false}) async {
    final query = unreadOnly ? '?unread_only=true&per_page=50' : '?per_page=50';
    final data = await auth.authedRequest('GET', '/notifications$query');
    final items = (data!['items'] as List<dynamic>).cast<Map<String, dynamic>>();
    return items.map(AppNotification.fromJson).toList();
  }

  Future<int> unreadCount() async {
    final data = await auth.authedRequest('GET', '/notifications/unread-count');
    return data!['unread_count'] as int;
  }

  Future<void> markRead(String id) async {
    await auth.authedRequest('PATCH', '/notifications/$id/read');
  }

  Future<int> markAllRead() async {
    final data = await auth.authedRequest('PATCH', '/notifications/read-all');
    return data!['updated_count'] as int;
  }

  // تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — مستوى القناة بس، مش لكل نوع إشعار.
  // in_app مش من ضمن القنوات المرجّعة هنا عمدًا (مش قابلة للتعطيل من الباك-إند أصلاً).
  Future<List<NotificationChannelPreference>> fetchPreferences() async {
    final items = await auth.authedRequestList('/me/notification-preferences');
    return items.map(NotificationChannelPreference.fromJson).toList();
  }

  Future<void> updatePreference(String channel, bool isEnabled) async {
    await auth.authedRequest('PATCH', '/me/notification-preferences/$channel', body: {'is_enabled': isEnabled});
  }
}
