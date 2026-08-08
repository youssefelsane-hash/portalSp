import '../../core/auth_repository.dart';
import 'models.dart';

class ChatRepository {
  final AuthRepository auth;

  ChatRepository(this.auth);

  // 404 لو الطلب مالوش thread لسه — نادراً ما يحصل هنا لأن الفني بيوصل للشات بعد ما هو نفسه
  // قابل الطلب (اللي بينشئ الـ thread أوتوماتيك)، بس بنسيبها ترمي زي ما هي عشان الوضوح.
  Future<String> getThreadIdForOrder(String orderId) async {
    final data = await auth.authedRequest('GET', '/chat/orders/$orderId/thread');
    return data!['id'] as String;
  }

  Future<List<ChatMessage>> listMessages(String threadId) async {
    final items = await auth.authedRequestList('/chat/threads/$threadId/messages');
    return items.map(ChatMessage.fromJson).toList();
  }
}
