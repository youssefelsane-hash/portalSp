// صندوق إشعارات داخل التطبيق (docs/08) — مختلف عن push، مطابق لـ
// apps/api/src/modules/notifications/dto/notification-response.dto.ts.
class AppNotification {
  final String id;
  final String notificationType;
  final String titleAr;
  final String bodyAr;
  final String? deepLink;
  final String? readAt;
  final String createdAt;

  AppNotification({
    required this.id,
    required this.notificationType,
    required this.titleAr,
    required this.bodyAr,
    required this.deepLink,
    required this.readAt,
    required this.createdAt,
  });

  bool get isUnread => readAt == null;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        notificationType: json['notification_type'] as String,
        titleAr: json['title_ar'] as String,
        bodyAr: json['body_ar'] as String,
        deepLink: json['deep_link'] as String?,
        readAt: json['read_at'] as String?,
        createdAt: json['created_at'] as String,
      );
}
