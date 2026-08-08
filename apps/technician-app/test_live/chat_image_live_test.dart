// اختبار حي حقيقي لرفع صور في الشات من ناحية الفني (message_type=image, file_url) ضد apps/api
// الشغال فعلاً — تكملة لـ apps/customer-app/test_live/chat_image_live_test.dart اللي بتغطي
// اتجاه العميل، هنا بنتأكد إن apiUpload بتاع apps/technician-app نفسه شغال لنفس الـ endpoint
// وإن العميل بيستقبل صورة الفني لحظياً عبر WebSocket.
// شغّله بـ: flutter test test_live/chat_image_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_config.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('[OTP]') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _loginAs(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('فني يرفع صورة في شات الطلب والعميل يستقبلها لحظياً عبر WebSocket', () async {
    final customerToken = await _loginAs('+201000009999');
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
      },
    );
    final orderId = order!['id'] as String;

    final technicianToken = await _loginAs('+201000000011');
    await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);

    final threadResponse = await apiRequest('GET', '/chat/orders/$orderId/thread', accessToken: technicianToken);
    final threadId = threadResponse!['id'] as String;

    final socketBaseUrl = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    final customerSocket = socket_io.io(
      '$socketBaseUrl/chat',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': customerToken})
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );

    try {
      final customerJoined = Completer<void>();
      customerSocket.onConnect((_) => customerSocket.emit('chat:join', {'thread_id': threadId}));
      customerSocket.on('chat:joined', (_) {
        if (!customerJoined.isCompleted) customerJoined.complete();
      });
      customerSocket.connect();
      await customerJoined.future.timeout(const Duration(seconds: 10));

      final customerReceivedImage = Completer<Map<String, dynamic>>();
      customerSocket.on('chat:message_received', (data) {
        final map = (data as Map).cast<String, dynamic>();
        if (map['message_type'] == 'image' && !customerReceivedImage.isCompleted) {
          customerReceivedImage.complete(map);
        }
      });

      final imageBytes = await File('test_live/fixtures/test-1x1.png').readAsBytes();
      final uploadResponse = await apiUpload(
        '/chat/threads/$threadId/messages/image',
        fileBytes: imageBytes,
        filename: 'before.png',
        fields: const {},
        accessToken: technicianToken,
      );
      expect(uploadResponse, isNotNull);
      expect(uploadResponse!['message_type'], 'image');
      expect(uploadResponse['sender_user_id'], isNotNull);
      expect((uploadResponse['file_url'] as String).contains('/uploads/chat/$threadId/'), isTrue);

      final wsMessage = await customerReceivedImage.future.timeout(const Duration(seconds: 10));
      expect(wsMessage['id'], uploadResponse['id']);
      expect(wsMessage['file_url'], uploadResponse['file_url']);
    } finally {
      customerSocket.disconnect();
      customerSocket.dispose();
    }

    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي'});
  });
}
