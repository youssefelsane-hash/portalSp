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
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import 'package:customer_app/features/orders/models.dart';
import 'package:flutter_test/flutter_test.dart';

// نفس أدوات باقي اختبارات `test_live/` — الملف ده كان شايل **نسخته الخاصة** من قراءة الـOTP
// بمسارات لوج مكتوبة بالإيد لسيشن قديمة، فكان بيفشل في أي سيشن تانية على `StateError` مالوش
// أي علاقة بالكود المختبَر. `_live_support.dart` بيدوّر على اللوج وبيقبل `--dart-define=API_LOG_PATH`.
import '_live_support.dart';

void main() {
  test('GET /orders بيترد كصفحة {data: [...], meta} وapiRequestPage بيقراها من غير ما يرمي', () async {
    final phone = uniquePhone();
    final token = await registerCustomer(phone, fullName: 'عميل اختبار قايمة الطلبات');

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
