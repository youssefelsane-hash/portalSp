import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../../core/api_config.dart';

// OrderTrackingGateway (apps/api/src/modules/orders/order-tracking.gateway.ts) namespace
// /tracking مركّب على جذر السيرفر، مش تحت /api/v1 — لازم نقطع الجزء ده من apiBaseUrl.
String get _socketBaseUrl {
  final withoutApiV1 = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  return withoutApiV1;
}

class TrackingUpdate {
  final double latitude;
  final double longitude;

  TrackingUpdate({required this.latitude, required this.longitude});
}

// عميل تتبع لحظي عبر Socket.IO — مطابق تماماً لعقد OrderTrackingGateway (namespace /tracking،
// auth.token في الـ handshake، حدث tracking:join بـ order_id، ورد order:location_updated).
class OrderTrackingClient {
  socket_io.Socket? _socket;

  void connect({
    required String accessToken,
    required String orderId,
    required void Function(TrackingUpdate) onLocationUpdate,
    void Function(String message)? onError,
    void Function()? onJoined,
  }) {
    final socket = socket_io.io(
      '$_socketBaseUrl/tracking',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          // socket_io_client بيشارك/يعيد استخدام نفس الـ Manager لنفس الـ URI افتراضياً — لو
          // فيه أكتر من TrackingScreen اتفتحت (حتى لو القديمة اتقفلت من غير dispose كامل)،
          // بيقدر يتلخبط ويقفل الاتصال الأول. اتلقطت البَقّة دي فعلياً وقت اختبار حي محتاج
          // اتصالين متوازيين (عميل+فني) في نفس الـ process — نفس الفخ ممكن يحصل هنا لو حصل
          // تنقّل سريع بين الشاشات.
          .enableForceNew()
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) => socket.emit('tracking:join', {'order_id': orderId}));
    socket.on('tracking:joined', (_) => onJoined?.call());
    socket.on('order:location_updated', (data) {
      final map = data as Map<dynamic, dynamic>;
      onLocationUpdate(TrackingUpdate(
        latitude: (map['latitude'] as num).toDouble(),
        longitude: (map['longitude'] as num).toDouble(),
      ));
    });
    socket.on('error', (data) {
      final map = data as Map<dynamic, dynamic>?;
      onError?.call(map?['message'] as String? ?? 'حصل خطأ في الاتصال');
    });

    socket.connect();
  }

  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
