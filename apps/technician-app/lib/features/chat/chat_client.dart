import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../../core/api_config.dart';
import 'models.dart';

String get _socketBaseUrl => apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');

// عميل شات حي — مطابق لـ ChatGateway (namespace /chat، chat:join{thread_id}،
// chat:send{thread_id, content}، chat:message_received).
class ChatClient {
  socket_io.Socket? _socket;

  void connect({
    required String accessToken,
    required String threadId,
    required void Function(ChatMessage) onMessageReceived,
    void Function()? onJoined,
    void Function(String message)? onError,
  }) {
    final socket = socket_io.io(
      '$_socketBaseUrl/chat',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) => socket.emit('chat:join', {'thread_id': threadId}));
    socket.on('chat:joined', (_) => onJoined?.call());
    socket.on('chat:message_received', (data) {
      onMessageReceived(ChatMessage.fromJson((data as Map).cast<String, dynamic>()));
    });
    socket.on('error', (data) {
      final map = data as Map<dynamic, dynamic>?;
      onError?.call(map?['message'] as String? ?? 'حصل خطأ في الشات');
    });

    socket.connect();
  }

  void sendMessage(String threadId, String content) {
    _socket?.emit('chat:send', {'thread_id': threadId, 'content': content});
  }

  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
