import 'dart:typed_data';
import '../../core/auth_repository.dart';
import 'models.dart';

class ChatRepository {
  final AuthRepository auth;

  ChatRepository(this.auth);

  // 404 لو الفني لسه ما قبلش الطلب (مفيش thread اتعمل بعد) — الكولر مسؤول يتعامل معاها.
  Future<String> getThreadIdForOrder(String orderId) async {
    final data = await auth.authedRequest('GET', '/chat/orders/$orderId/thread');
    return data!['id'] as String;
  }

  Future<List<ChatMessage>> listMessages(String threadId) async {
    final items = await auth.authedRequestList('/chat/threads/$threadId/messages');
    return items.map(ChatMessage.fromJson).toList();
  }

  // رفع صورة كرسالة — REST بس (نفس نمط رفع صور الطلب)، الباك-إند بيبثها عبر WebSocket
  // للطرف التاني بعد الحفظ مباشرة، فمفيش داعي نستنى رد الـ REST عشان الطرف التاني يشوفها.
  Future<ChatMessage> sendImageMessage(String threadId, Uint8List fileBytes, String filename) async {
    final data = await auth.authedUpload('/chat/threads/$threadId/messages/image', fileBytes: fileBytes, filename: filename);
    return ChatMessage.fromJson(data!);
  }
}
