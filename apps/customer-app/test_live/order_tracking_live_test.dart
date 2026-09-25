// اختبار حي حقيقي لتتبع الطلب اللحظي عبر Socket.IO ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/. socket_io_client بيشتغل من غير مشكلة على Dart VM خام (مش مرتبط بـ
// TestWidgetsFlutterBinding زي http)، فمفيش داعي لأي حاجة تانية غير test() العادي.
// شغّله بـ: flutter test test_live/order_tracking_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_config.dart';
import '_live_support.dart';


void main() {
  test('عميل بيتابع فني حقيقي لحظياً عبر WebSocket ويستقبل تحديث موقع حقيقي', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final customerToken = await registerCustomer(uniquePhone());
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(),
        // ADR-0060 §4 / migration 0340 — كل خدمات الكتالوج بقت بدقة «يوم + ساعة وصول»،
        // فالموعد إجباري. القيمة من `bookableScheduledAt()` — الشرح هناك.
        'scheduled_at': bookableScheduledAt(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار تتبع لحظي ${DateTime.now().microsecondsSinceEpoch}',
      },
    );
    final orderId = order!['id'] as String;

    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع، فالاختبار مايفترضش النتيجة
    // (تفاصيل كاملة فوق `claimOrderAsTechnician`، §148).
    final technicianToken = await claimOrderAsTechnician(orderId, '+201000000013');
    final accepted = await apiRequest('GET', '/orders/$orderId', accessToken: customerToken);
    expect(accepted!['order_status'], 'accepted');

    // **`depart` مش خطوة زيادة (تدقيق §148)**: الـgateway بيبثّ `order:location_updated` للطلبات
    // اللي الفني **في طريقه ليها** بس (`findOrdersInTransitForTechnician` = `technician_on_way`)،
    // وده تعريف صح — العميل مايتتبعش فني لسه ماتحركش. الاختبار كان بيقف عند `accepted` وبعدين
    // يستنى بث عمره ما هييجي، فيسقط بـTimeout على **سلوك سليم**.
    final departed = await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    expect(departed!['order_status'], 'technician_on_way');

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
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
  });
}
