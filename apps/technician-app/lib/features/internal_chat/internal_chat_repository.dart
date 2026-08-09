import '../../core/auth_repository.dart';
import 'models.dart';

class InternalChatRepository {
  final AuthRepository auth;

  InternalChatRepository(this.auth);

  Future<List<InternalContact>> fetchContacts() async {
    final items = await auth.authedRequestList('/internal-chat/contacts');
    return items.map(InternalContact.fromJson).toList();
  }

  Future<List<InternalThread>> fetchThreads() async {
    final items = await auth.authedRequestList('/internal-chat/threads');
    return items.map(InternalThread.fromJson).toList();
  }

  Future<InternalThread> startThread(String peerUserId) async {
    final data = await auth.authedRequest('POST', '/internal-chat/threads', body: {'peer_user_id': peerUserId});
    return InternalThread.fromJson(data!);
  }

  Future<List<InternalMessage>> fetchMessages(String threadId) async {
    final items = await auth.authedRequestList('/internal-chat/threads/$threadId/messages');
    return items.map(InternalMessage.fromJson).toList();
  }

  Future<InternalMessage> sendMessage(String threadId, String content) async {
    final data = await auth.authedRequest('POST', '/internal-chat/threads/$threadId/messages', body: {'content': content});
    return InternalMessage.fromJson(data!);
  }
}
