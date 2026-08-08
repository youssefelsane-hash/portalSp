class ChatMessage {
  final String id;
  final String threadId;
  final String senderUserId;
  final String messageType;
  final String? content;
  final String? fileUrl;
  final DateTime createdAt;

  ChatMessage({
    required this.id,
    required this.threadId,
    required this.senderUserId,
    required this.messageType,
    required this.content,
    required this.fileUrl,
    required this.createdAt,
  });

  bool get isImage => messageType == 'image';

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        threadId: json['thread_id'] as String,
        senderUserId: json['sender_user_id'] as String,
        messageType: json['message_type'] as String? ?? 'text',
        content: json['content'] as String?,
        fileUrl: json['file_url'] as String?,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}
