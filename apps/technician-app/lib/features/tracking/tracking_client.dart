import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import '../../core/api_config.dart';

// OrderTrackingGateway (apps/api/src/modules/orders/order-tracking.gateway.ts) namespace
// /tracking مركّب على جذر السيرفر، مش تحت /api/v1 — لازم نقطع الجزء ده من apiBaseUrl.
String get _socketBaseUrl {
  final withoutApiV1 = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
  return withoutApiV1;
}

// عميل تتبع الفني — بيبعت موقع، نفس عقد OrderTrackingGateway. الموقع بيتحدد أوتوماتيك في
// الباك-إند من `order_status IN (...)` بتاع الفني نفسه (technician_profiles.id)، فمش محتاج
// order_id لبث الموقع نفسه.
//
// تحديث لحظي بعد قرار عرض السعر (docs/08 §15) — كانت فجوة موثّقة صراحة: شاشة تنفيذ الطلب
// المفتوحة عند الفني كانت بتفضل عارضة `awaiting_quote_approval` القديمة لحد ما هو يخرج ويرجع
// يدوي، رغم إن الباك-إند بيبعت إشعار push/in-app فوري لحظة قرار العميل. بننضم دلوقتي لنفس
// غرفة `order:${orderId}` اللي العميل بينضملها أصلاً (`tracking:join`)، ونستقبل `order:status_changed`
// (`OrderTrackingGateway.handleOrderStatusChanged()`) — بث عام لأي تغيير حالة، مش خاص بعرض
// السعر بس، عشان أي حالة تانية (إلغاء الأدمن مثلاً) تتصلح بنفس الآلية.
class TechnicianTrackingClient {
  socket_io.Socket? _socket;

  void connect({
    required String accessToken,
    String? orderId,
    void Function(String message)? onError,
    void Function(String previousStatus, String newStatus)? onOrderStatusChanged,
  }) {
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
    if (orderId != null) {
      socket.onConnect((_) => socket.emit('tracking:join', {'order_id': orderId}));
      socket.on('order:status_changed', (data) {
        final map = data as Map<dynamic, dynamic>;
        onOrderStatusChanged?.call(map['previous_status'] as String, map['new_status'] as String);
      });
    }
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
