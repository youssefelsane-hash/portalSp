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
}
