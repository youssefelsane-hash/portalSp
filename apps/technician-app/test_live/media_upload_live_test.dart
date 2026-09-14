// اختبار حي حقيقي لرفع صورة قبل/بعد على طلب حقيقي ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/. مفيش camera/emulator حقيقي هنا (documented gap)، فبيستخدم صورة PNG 1×1 حقيقية
// (test_live/fixtures/test-1x1.png) كملف حقيقي بيتبعت فعلاً — كافي لاختبار الـ multipart upload
// وتخزين الملف نفسه (LocalDiskStorageService، راجع orders/README.md)، مش شكل الصورة نفسها.
// شغّله بـ: flutter test test_live/media_upload_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('فني حقيقي يقبل طلب حقيقي ويرفع صورة قبل/بعد حقيقية عليه', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار حي لرفع الصور',
      },
    );
    final orderId = order!['id'] as String;

    var technicianToken = await devTechnicianToken('+201000000043');
    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع (تفاصيل فوق
    // `claimOrderAsTechnician`، §148).
    technicianToken = await claimOrderAsTechnician(orderId, '+201000000043');
    final accepted = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(accepted!['order_status'], 'accepted');

    final imageBytes = await File('test_live/fixtures/test-1x1.png').readAsBytes();

    final beforeMedia = await apiUpload(
      '/technician/orders/$orderId/media',
      fileBytes: imageBytes,
      filename: 'before.png',
      fields: {'media_type': 'before_photo', 'caption': 'اختبار حي قبل الشغل'},
      accessToken: technicianToken,
    );
    expect(beforeMedia, isNotNull);
    expect(beforeMedia!['media_type'], 'before_photo');
    expect(beforeMedia['caption'], 'اختبار حي قبل الشغل');
    expect(beforeMedia['file_url'], isNotEmpty);

    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    // صورة «بعد الشغل» **قبل** `complete` مش بعده: الباك-إند بقى بيفرض وجودها كشرط لقفل
    // الطلب («لازم ترفع صورة واحدة على الأقل بعد الشغل قبل ما تقفل الطلب»). الترتيب القديم
    // كان بيتصرّف كأن الشرط مش موجود (تدقيق §148).
    final afterMedia = await apiUpload(
      '/technician/orders/$orderId/media',
      fileBytes: imageBytes,
      filename: 'after.png',
      fields: {'media_type': 'after_photo'},
      accessToken: technicianToken,
    );
    expect(afterMedia, isNotNull);
    expect(afterMedia!['media_type'], 'after_photo');

    final completed =
        await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final mediaList = await apiRequestList('/technician/orders/$orderId/media', accessToken: technicianToken);
    expect(mediaList.length, 2);
    expect(mediaList.map((m) => m['media_type']).toSet(), {'before_photo', 'after_photo'});

    // خلّص دورة الطلب — كاش، عشان مفيش طلب معلّق يتراكم من الاختبارات الحية
    await apiRequest('POST', '/technician/orders/$orderId/collect-cash', accessToken: technicianToken);
  });
}
