// اختبار انحدار حي لبَقّة **«صفحة طلباتي ما بتفتحش، بتفضل تحمّل»** (بلاغ مالك 2026-09-10).
//
// السبب الحقيقي: `GET /orders` بيرجّع من الكونترولر `{items, meta}`، لكن `ResponseInterceptor`
// في الباك-إند بيرفع `items` لـ`data` ويحط `meta` **جنبها** في الـenvelope. يعني الرد الفعلي
// `{success, data: [...], meta: {...}}`. الكود القديم كان بينده `authedRequest()` (اللي بيعمل
// `data as Map`) وبعدين يقرا `data['items']` — فالكاست كان بيرمي `TypeError`، والشاشة بتمسك
// `ApiException` بس، فالاستثناء هرب و`_orders` فضلت `null` = عجلة تحميل للأبد بلا أي رسالة.
//
// الاختبار ده بيثبّت الحاجتين اللي لازم يفضلوا صح:
//   ١. `apiRequestPage()` بيقرا الصفحة صح ويحوّل عناصرها لـ`Order` من غير أي استثناء.
//   ٢. `apiRequest()` على نفس المسار بيرمي `ApiException` نضيفة (مش `TypeError` خام) — يعني
//      حتى لو حد رجع للنمط الغلط، الشاشة هتعرض رسالة مش تعلّق.
//
// شغّله بـ:
//   flutter test test_live/orders_list_page_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';

import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import 'package:customer_app/features/orders/models.dart';
import 'package:flutter_test/flutter_test.dart';

const _apiLogCandidates = <String>[
  '/tmp/claude-0/api.log',
  '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
];

Future<String> _latestOtpFor(String phoneNumber) async {
  for (final path in _apiLogCandidates) {
    final log = File(path);
    if (!log.existsSync()) continue;
    final lines = await log.readAsLines();
    final match = lines.where((line) => line.contains('[OTP]') && line.contains(phoneNumber));
    if (match.isNotEmpty) return match.last.split('→').last.trim();
  }
  throw StateError('مالقيتش OTP لـ$phoneNumber في لوج الباك-إند');
}

Future<String> _registerCustomer(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'register'});
  await Future<void>.delayed(const Duration(milliseconds: 600));
  final otp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/register', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
    'full_name': 'عميل اختبار قايمة الطلبات',
    'user_type': 'customer',
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('GET /orders بيترد كصفحة {data: [...], meta} وapiRequestPage بيقراها من غير ما يرمي', () async {
    final phone = '+2011${DateTime.now().millisecondsSinceEpoch % 100000000}';
    final token = await _registerCustomer(phone);

    // عميل جديد = صفر طلبات. المهم هنا مش عدد الطلبات، المهم إن **الرد نفسه** بيتقرا صح:
    // البَقّة كانت بتضرب على شكل الرد، مش على محتواه، فحتى صفحة فاضية كانت بتعلّق الشاشة.
    final page = await apiRequestPage('/orders?limit=20', accessToken: token);
    expect(page.items, isA<List<Map<String, dynamic>>>());
    expect(() => page.items.map(Order.fromJson).toList(), returnsNormally);
    expect(page.nextCursor, isNull);
    expect(page.hasMore, isFalse);

    // النمط الغلط لازم يفضل خطأ **معلن**: `ApiException` بتوصل للشاشة كرسالة، مش `TypeError`
    // بيهرب ويسيبها على التحميل للأبد.
    await expectLater(
      apiRequest('GET', '/orders?limit=20', accessToken: token),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'BAD_RESPONSE')),
    );
  }, timeout: const Timeout(Duration(seconds: 90)));
}
