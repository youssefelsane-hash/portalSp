// اختبار حي حقيقي لشات الطلب اللحظي عبر Socket.IO ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/.
// شغّله بـ: flutter test test_live/chat_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_config.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';


void main() {
  test('عميل وفني حقيقيين يتبادلوا رسائل حية على شات الطلب', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final customerToken = await registerCustomer(uniquePhone());

    // مفيش thread قبل ما فني يقبل — بيتأكد إن الـ 404 الصريح شغال قبل ما نكمل.
    final beforeAccept = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(),
        'address_id': await ensureAddressFor(customerToken),
      },
    );
    final orderId = beforeAccept!['id'] as String;

    ApiException? noThreadError;
    try {
      await apiRequest('GET', '/chat/orders/$orderId/thread', accessToken: customerToken);
    } on ApiException catch (err) {
      noThreadError = err;
    }
    expect(noThreadError, isNotNull);
    expect(noThreadError!.statusCode, 404);

    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع، فالاختبار مايفترضش النتيجة
    // (تفاصيل كاملة فوق `claimOrderAsTechnician`، §148).
    final technicianToken = await claimOrderAsTechnician(orderId, '+201000000014');
    final accepted = await apiRequest('GET', '/orders/$orderId', accessToken: customerToken);
    expect(accepted!['order_status'], 'accepted');

    final threadResponse = await apiRequest('GET', '/chat/orders/$orderId/thread', accessToken: customerToken);
    expect(threadResponse, isNotNull);
    expect(threadResponse!['order_id'], orderId);
    final threadId = threadResponse['id'] as String;

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
      final customerJoined = Completer<void>();
      final technicianJoined = Completer<void>();
      customerSocket.onConnect((_) => customerSocket.emit('chat:join', {'thread_id': threadId}));
      customerSocket.on('chat:joined', (_) {
        if (!customerJoined.isCompleted) customerJoined.complete();
      });
      technicianSocket.onConnect((_) => technicianSocket.emit('chat:join', {'thread_id': threadId}));
      technicianSocket.on('chat:joined', (_) {
        if (!technicianJoined.isCompleted) technicianJoined.complete();
      });
      customerSocket.connect();
      technicianSocket.connect();
      await Future.wait([
        customerJoined.future.timeout(const Duration(seconds: 10)),
        technicianJoined.future.timeout(const Duration(seconds: 10)),
      ]);

      // الفني بيستقبل رسالة العميل
      final technicianReceived = Completer<Map<String, dynamic>>();
      technicianSocket.on('chat:message_received', (data) {
        if (!technicianReceived.isCompleted) {
          technicianReceived.complete((data as Map).cast<String, dynamic>());
        }
      });
      customerSocket.emit('chat:send', {'thread_id': threadId, 'content': 'إمتى هتوصل؟'});
      final msg1 = await technicianReceived.future.timeout(const Duration(seconds: 10));
      expect(msg1['content'], 'إمتى هتوصل؟');
      expect(msg1['thread_id'], threadId);

      // العميل بيستقبل رد الفني
      final customerReceived = Completer<Map<String, dynamic>>();
      customerSocket.on('chat:message_received', (data) {
        final map = (data as Map).cast<String, dynamic>();
        if (map['content'] == 'وصلت خلال 10 دقايق' && !customerReceived.isCompleted) {
          customerReceived.complete(map);
        }
      });
      technicianSocket.emit('chat:send', {'thread_id': threadId, 'content': 'وصلت خلال 10 دقايق'});
      final msg2 = await customerReceived.future.timeout(const Duration(seconds: 10));
      expect(msg2['content'], 'وصلت خلال 10 دقايق');

      // تاريخ الرسائل عبر REST لازم يرجّع الاتنين بالترتيب
      final history = await apiRequestList('/chat/threads/$threadId/messages', accessToken: customerToken);
      expect(history.length, 2);
      expect(history[0]['content'], 'إمتى هتوصل؟');
      expect(history[1]['content'], 'وصلت خلال 10 دقايق');
    } finally {
      customerSocket.disconnect();
      technicianSocket.disconnect();
      customerSocket.dispose();
      technicianSocket.dispose();
    }

    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
  });
}
