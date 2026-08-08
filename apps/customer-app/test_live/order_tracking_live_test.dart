// اختبار حي حقيقي لتتبع الطلب اللحظي عبر Socket.IO ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/. socket_io_client بيشتغل من غير مشكلة على Dart VM خام (مش مرتبط بـ
// TestWidgetsFlutterBinding زي http)، فمفيش داعي لأي حاجة تانية غير test() العادي.
// شغّله بـ: flutter test test_live/order_tracking_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_config.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
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
  test('عميل بيتابع فني حقيقي لحظياً عبر WebSocket ويستقبل تحديث موقع حقيقي', () async {
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
    final accepted = await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);
    expect(accepted!['order_status'], 'accepted');

    final socketBaseUrl = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');

    final customerSocket = socket_io.io(
      '$socketBaseUrl/tracking',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': customerToken})
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );
    final technicianSocket = socket_io.io(
      '$socketBaseUrl/tracking',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': technicianToken})
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );

    try {
      final joinedCompleter = Completer<void>();
      customerSocket.onConnect((_) => customerSocket.emit('tracking:join', {'order_id': orderId}));
      customerSocket.on('tracking:joined', (_) {
        if (!joinedCompleter.isCompleted) joinedCompleter.complete();
      });
      customerSocket.on('error', (data) {
        if (!joinedCompleter.isCompleted) {
          joinedCompleter.completeError(StateError((data as Map)['message'].toString()));
        }
      });
      customerSocket.connect();
      await joinedCompleter.future.timeout(const Duration(seconds: 10));

      final locationCompleter = Completer<Map<String, dynamic>>();
      customerSocket.on('order:location_updated', (data) {
        if (!locationCompleter.isCompleted) {
          locationCompleter.complete((data as Map).cast<String, dynamic>());
        }
      });

      technicianSocket.connect();
      await Future<void>.delayed(const Duration(milliseconds: 500));
      technicianSocket.emit('technician:location', {'latitude': 30.123456, 'longitude': 31.654321});

      final received = await locationCompleter.future.timeout(const Duration(seconds: 10));
      expect(received['order_id'], orderId);
      expect((received['latitude'] as num).toDouble(), closeTo(30.123456, 0.0001));
      expect((received['longitude'] as num).toDouble(), closeTo(31.654321, 0.0001));
    } finally {
      customerSocket.disconnect();
      technicianSocket.disconnect();
      customerSocket.dispose();
      technicianSocket.dispose();
    }

    // نظافة: نلغي الطلب التجريبي عشان مايفضلش معلّق في searching/accepted
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي'});
  });
}
