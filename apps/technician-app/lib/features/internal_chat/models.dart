class InternalContact {
  final String userId;
  final String fullName;
  final String userType;

  InternalContact({required this.userId, required this.fullName, required this.userType});

  factory InternalContact.fromJson(Map<String, dynamic> json) => InternalContact(
        userId: json['user_id'] as String,
        fullName: json['full_name'] as String,
        userType: json['user_type'] as String,
      );
}

class InternalThread {
  final String id;
  final String peerUserId;
  final String peerFullName;
  final String peerUserType;
  final DateTime? lastMessageAt;

  InternalThread({
    required this.id,
    required this.peerUserId,
    required this.peerFullName,
    required this.peerUserType,
    required this.lastMessageAt,
  });

  factory InternalThread.fromJson(Map<String, dynamic> json) => InternalThread(
        id: json['id'] as String,
        peerUserId: json['peer_user_id'] as String,
        peerFullName: json['peer_full_name'] as String,
        peerUserType: json['peer_user_type'] as String,
        lastMessageAt: json['last_message_at'] != null ? DateTime.parse(json['last_message_at'] as String) : null,
      );
}

class InternalMessage {
  final String id;
  final String threadId;
  final String senderUserId;
  final String content;
  final DateTime createdAt;

  InternalMessage({
    required this.id,
    required this.threadId,
    required this.senderUserId,
    required this.content,
    required this.createdAt,
  });

  factory InternalMessage.fromJson(Map<String, dynamic> json) => InternalMessage(
        id: json['id'] as String,
        threadId: json['thread_id'] as String,
        senderUserId: json['sender_user_id'] as String,
        content: json['content'] as String,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}
