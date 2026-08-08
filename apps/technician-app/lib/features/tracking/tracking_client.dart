import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../../core/api_config.dart';

// OrderTrackingGateway (apps/api/src/modules/orders/order-tracking.gateway.ts) namespace
// /tracking مركّب على جذر السيرفر، مش تحت /api/v1 — لازم نقطع الجزء ده من apiBaseUrl.
String get _socketBaseUrl {
  final withoutApiV1 = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  return withoutApiV1;
}

// عميل تتبع الفني — بيبعت موقع بس، نفس عقد OrderTrackingGateway. الطلب بيتحدد أوتوماتيك في
// الباك-إند من `order_status IN (...)` بتاع الفني نفسه (technician_profiles.id)، فمش محتاج
// order_id هنا (عكس تطبيق العميل اللي بينضم لغرفة طلب معيّن).
class TechnicianTrackingClient {
  socket_io.Socket? _socket;

  void connect({required String accessToken, void Function(String message)? onError}) {
    final socket = socket_io.io(
      '$_socketBaseUrl/tracking',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          // راجع نفس التعليق في customer-app/tracking_client.dart — منع socket_io_client من
          // مشاركة Manager قديم مقفول أو مش متاح.
          .enableForceNew()
          .build(),
    );
    _socket = socket;
    socket.on('error', (data) {
      final map = data as Map<dynamic, dynamic>?;
      onError?.call(map?['message'] as String? ?? 'حصل خطأ في الاتصال');
    });
    socket.connect();
  }

  void sendLocation({required double latitude, required double longitude}) {
    _socket?.emit('technician:location', {'latitude': latitude, 'longitude': longitude});
  }

  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
