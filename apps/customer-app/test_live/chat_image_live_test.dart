// اختبار حي حقيقي لرفع صور في الشات (message_type=image, file_url) ضد apps/api الشغال فعلاً —
// كانت فجوة موثّقة (chat_messages.file_url/message_type=image موجودين في الـ schema من أول يوم
// بس مفيش endpoint كان بيستخدمهم). نفس أسلوب باقي test_live/.
// شغّله بـ: flutter test test_live/chat_image_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_config.dart';
import 'package:customer_app/core/api_exception.dart';

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

// أصغر PNG صحيح ممكن (1×1 بكسل أحمر) — كافي لاختبار مسار الرفع نفسه، مش محتوى الصورة.
final List<int> _tinyPng = [
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
  0x44, 0xAE, 0x42, 0x60, 0x82,
];

void main() {
  test('عميل يرفع صورة في شات الطلب والفني يستقبلها لحظياً + تاريخها يرجع صح', () async {
    final customerToken = await _loginAs('+201000009999');

    final created = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
      },
    );
    final orderId = created!['id'] as String;

    final technicianToken = await _loginAs('+201000000011');
    await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);

    final threadResponse = await apiRequest('GET', '/chat/orders/$orderId/thread', accessToken: customerToken);
    final threadId = threadResponse!['id'] as String;

    final socketBaseUrl = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    final technicianSocket = socket_io.io(
      '$socketBaseUrl/chat',
      socket_io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': technicianToken})
          .disableAutoConnect()
          .enableForceNew()
          .build(),
    );

    try {
      final technicianJoined = Completer<void>();
      technicianSocket.onConnect((_) => technicianSocket.emit('chat:join', {'thread_id': threadId}));
      technicianSocket.on('chat:joined', (_) {
        if (!technicianJoined.isCompleted) technicianJoined.complete();
      });
      technicianSocket.connect();
      await technicianJoined.future.timeout(const Duration(seconds: 10));

      final technicianReceivedImage = Completer<Map<String, dynamic>>();
      technicianSocket.on('chat:message_received', (data) {
        final map = (data as Map).cast<String, dynamic>();
        if (map['message_type'] == 'image' && !technicianReceivedImage.isCompleted) {
          technicianReceivedImage.complete(map);
        }
      });

      // العميل بيرفع الصورة عبر REST (مفيش مسار WS لرفع ملفات) — الباك-إند المفروض يبثها
      // يدوياً للفني المنضم للـ room برضه.
      final uploadResponse = await apiUpload(
        '/chat/threads/$threadId/messages/image',
        fileBytes: _tinyPng,
        filename: 'test.png',
        accessToken: customerToken,
      );
      expect(uploadResponse, isNotNull);
      expect(uploadResponse!['message_type'], 'image');
      expect(uploadResponse['content'], isNull);
      expect(uploadResponse['file_url'], isNotNull);
      expect((uploadResponse['file_url'] as String).contains('/uploads/chat/$threadId/'), isTrue);

      final wsMessage = await technicianReceivedImage.future.timeout(const Duration(seconds: 10));
      expect(wsMessage['id'], uploadResponse['id']);
      expect(wsMessage['file_url'], uploadResponse['file_url']);

      // ملحوظة: رفض نوع الملف (VAL_001 لأي Content-Type غير JPEG/PNG/WEBP) مؤكّد يدوياً عبر
      // curl مباشر على الـ endpoint — مش قابل للاختبار هنا عبر apiUpload لأن _mediaTypeForFilename
      // (نفس نمط apps/technician-app) بيفرض دايماً Content-Type صورة صحيح بغض النظر عن الامتداد،
      // بما إن الاستخدام الحقيقي الوحيد للدالة دي هو صور حقيقية جايه من image_picker.

      // فني تاني مش صاحب الطلب يترفض 403
      final otherTechnicianToken = await _loginAs('+201099988877');
      ApiException? forbidden;
      try {
        await apiUpload(
          '/chat/threads/$threadId/messages/image',
          fileBytes: _tinyPng,
          filename: 'test2.png',
          accessToken: otherTechnicianToken,
        );
      } on ApiException catch (err) {
        forbidden = err;
      }
      expect(forbidden, isNotNull);
      expect(forbidden!.statusCode, 403);

      // تاريخ الرسائل عبر REST لازم يرجّع صورة العميل بـ file_url ومفيش content
      final history = await apiRequestList('/chat/threads/$threadId/messages', accessToken: customerToken);
      final imageMessages = history.where((m) => m['message_type'] == 'image').toList();
      expect(imageMessages.length, 1);
      expect(imageMessages.first['file_url'], uploadResponse['file_url']);
    } finally {
      technicianSocket.disconnect();
      technicianSocket.dispose();
    }

    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي'});
  });
}
