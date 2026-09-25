// اختبار حي لفصل الأدوار (ADR-0110) ضد apps/api الشغال فعلاً.
//
// **بلاغ المالك بالحرف**: «الصنايعي بيدخل تطبيق العميل بنفس رقمه ويعدّي كأن الحساب موجود، لكن
// أول ما يطلب أي خدمة بيتصدّ» و«العميل بيدخل تطبيق الفني من غير مستندات ولا onboarding ويلاقي
// شاشة نص محمّلة ومكتوب معندكش صلاحية». الملف ده بيمشي الحالتين لآخرهم على API حقيقي.
//
// شغّله بـ: flutter test test_live/account_roles_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';

/// دخول معلنًا الدور اللي التطبيق ده بيمثّله — نفس اللي `AuthRepository.loginWithPin` بيبعته.
Future<Map<String, dynamic>> loginAs(String phone, String role, {String pin = kLiveTestPin}) async {
  final tokens = await apiRequest('POST', '/auth/pin/login', body: {
    'phone_number': phone,
    'pin': pin,
    'role': role,
  });
  return tokens!;
}

void main() {
  test('صنايعي بيدخل تطبيق العميل بنفس رقمه ويطلب خدمة فعلاً — البلاغ الأصلي', () async {
    // فني حقيقي مسجّل بمسار الفني، بنفس الرقم بالظبط.
    final techPhone = uniquePhone();
    await apiRequest('POST', '/auth/pin/register', body: {
      'phone_number': techPhone,
      'pin': kLiveTestPin,
      'full_name': 'صنايعي كمان عميل (اختبار أدوار)',
      'user_type': 'technician',
    });

    // نفس الرقم على تطبيق العميل: **الدور بيتمنح تلقائيًا** — كونك عميل مالوش أي تحقّق، فطلب
    // خطوة زيادة من فني موثّق أصلاً عرقلة بلا مقابل أمني (ADR-0110 §7-أ).
    final asCustomer = await loginAs(techPhone, 'customer');
    final customerToken = asCustomer['access_token'] as String;

    final me = await apiRequest('GET', '/auth/me', accessToken: customerToken);
    // **الدور النشط هو دور التطبيق**، مش `users.user_type` — ده اللي بيخلي الشاشات تتبني صح.
    expect(me!['user_type'], 'customer');
    expect(me['roles'], containsAll(<String>['customer', 'technician']));

    // اللي كان بيرجع 403: عناويني، محفظتي، طلباتي.
    await apiRequestList('/addresses', accessToken: customerToken);
    await apiRequest('GET', '/wallet', accessToken: customerToken);
    await apiRequestList('/orders', accessToken: customerToken);

    // **وأهم حاجة: إنه يطلب خدمة فعلاً.** ده الجزء اللي كان مصدود في البلاغ.
    final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
      'service_id': await pickBookableServiceId(),
      'scheduled_at': bookableScheduledAt(),
      'address_id': await ensureAddressFor(customerToken),
      'problem_description': 'اختبار حي: صنايعي بيطلب خدمة كعميل (ADR-0110)',
    });
    expect(order!['order_status'], 'searching_technician');
    await apiRequest('POST', '/orders/${order['id']}/cancel', accessToken: customerToken, body: {
      'reason': 'تنظيف اختبار حي',
      'cancellation_reason_id': await pickCustomerCancellationReasonId(),
    });

    // ورجوعه لتطبيق الفني لازم يفضل فني كامل — المنحة الأصلية مااتلمستش.
    final asTechnician = await loginAs(techPhone, 'technician');
    final technicianToken = asTechnician['access_token'] as String;
    final techMe = await apiRequest('GET', '/auth/me', accessToken: technicianToken);
    expect(techMe!['user_type'], 'technician');
    await apiRequest('GET', '/technician/me', accessToken: technicianToken);

    // وبالتوكن ده **مش** المفروض يوصل لمسارات العميل — الجلسة بدور واحد نشط بس.
    ApiException? crossRole;
    try {
      await apiRequestList('/orders', accessToken: technicianToken);
    } on ApiException catch (err) {
      crossRole = err;
    }
    expect(crossRole?.statusCode, 403,
        reason: 'جلسة الفني وصلت لمسار العميل — الدور النشط مش بيتفرض');
  });

  test('عميل بيدخل تطبيق الفني: AUTH_008 بمخرج واضح، مش شاشة نص محمّلة', () async {
    final customerPhone = uniquePhone();
    await registerCustomer(customerPhone, fullName: 'عميل عايز يبقى صنايعي');

    // **الفرق عن الحالة اللي فوق مقصود**: دور الفني بيتحقّق منه (KYC) فمايتمنحش بمجرد فتح
    // التطبيق. الرد مُصنَّف عشان التطبيق يعرض «ضيف دور الصنايعي» بدل رسالة رفض بلا مخرج.
    ApiException? refusal;
    try {
      await loginAs(customerPhone, 'technician');
    } on ApiException catch (err) {
      refusal = err;
    }
    expect(refusal, isNotNull, reason: 'العميل دخل تطبيق الفني — ده البلاغ الأصلي');
    expect(refusal!.code, 'AUTH_008');
    expect(refusal.statusCode, 403);

    // المخرج: دخول كعميل ← طلب الدور ← دخول كفني. تلات خطوات كلها من السيرفر.
    final asCustomer = await loginAs(customerPhone, 'customer');
    final granted = await apiRequest('POST', '/auth/roles/technician',
        accessToken: asCustomer['access_token'] as String);
    expect(granted!['granted'], true);

    final asTechnician = await loginAs(customerPhone, 'technician');
    final me = await apiRequest('GET', '/auth/me', accessToken: asTechnician['access_token'] as String);
    expect(me!['user_type'], 'technician');
    expect(me['roles'], containsAll(<String>['customer', 'technician']));
    // والبروفايل اتعمل فعلاً — مش شاشة بتحمّل على الفاضي.
    await apiRequest('GET', '/technician/me', accessToken: asTechnician['access_token'] as String);
  });

  test('الأدمن ممنوع من تطبيقات العملاء والفنيين تمامًا', () async {
    // `+201000000001` أدمن مزروع. **مش** بيدخل من تطبيق مستهلك بأي دور.
    for (final role in ['customer', 'technician']) {
      ApiException? refusal;
      try {
        await loginAs('+201000000001', role);
      } on ApiException catch (err) {
        refusal = err;
      }
      expect(refusal?.statusCode, 403, reason: 'الأدمن دخل بدور $role');
    }
  });

  test('التدوير بيحافظ على الدور النشط ومايوسّعهوش', () async {
    final phone = uniquePhone();
    await registerCustomer(phone);
    final asCustomer = await loginAs(phone, 'customer');
    await apiRequest('POST', '/auth/roles/technician',
        accessToken: asCustomer['access_token'] as String);

    // الحساب بقى عنده الدورين. تدوير جلسة **العميل** لازم يرجع عميل — لو رجع بدور الفني
    // (حسب `users.user_type` أو حسب أوسع دور) يبقى ده توسيع صلاحية بالتدوير.
    final rotated = await apiRequest('POST', '/auth/refresh',
        body: {'refresh_token': asCustomer['refresh_token']});
    final rotatedToken = rotated!['access_token'] as String;
    final me = await apiRequest('GET', '/auth/me', accessToken: rotatedToken);
    expect(me!['user_type'], 'customer');

    ApiException? crossRole;
    try {
      await apiRequest('GET', '/technician/me', accessToken: rotatedToken);
    } on ApiException catch (err) {
      crossRole = err;
    }
    expect(crossRole?.statusCode, 403, reason: 'التدوير وسّع الدور');
  });
}
