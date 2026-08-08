class ChatMessage {
  final String id;
  final String threadId;
  final String senderUserId;
  final String? content;
  final DateTime createdAt;

  ChatMessage({
    required this.id,
    required this.threadId,
    required this.senderUserId,
    required this.content,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        threadId: json['thread_id'] as String,
        senderUserId: json['sender_user_id'] as String,
        content: json['content'] as String?,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}
