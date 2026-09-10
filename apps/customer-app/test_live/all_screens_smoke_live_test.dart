// **مسح كل شاشة العميل يقدر يوصلها** — ضد `apps/api` الشغّال فعلاً، ببيانات حقيقية.
//
// طلب المالك بالحرف (2026-09-10): «هتبتدي تلف على كل الواجهات اللي الكاستمر ينفع يشوفها…
// وتتأكد إن مفيش أي صفحة بتجيب إيرور، مفيش أي صفحة بتعمل المنظر ده كده اللي هو مش بيتحمل
// أصلاً… واتأكدلي إن الأبليكيشن كله flexible مع حجم الشاشة».
//
// الملف ده بيعمل التلاتة في مكان واحد، وبشكل **قابل لإعادة التشغيل** (مش لقطات بالإيد):
//
//   ١. **مفيش استثناء**: أي استثناء أثناء البناء أو بعد استقرار الشاشة بيفشّل الحالة.
//   ٢. **مفيش شاشة معلّقة**: بعد ما البيانات توصل، الشاشة لازم تعرض **محتوى أو رسالة**، مش
//      تفضل على مؤشر تحميل. الفحص ده هو اللي كان هيمسك بَقّة «طلباتي» من أول يوم.
//   ٣. **مفيش تهتك بيكسل (overflow)**: `flutter_test` بيحوّل أي `RenderFlex overflowed`
//      لاستثناء، وإحنا بنشغّل كل شاشة على **تلات مقاسات** — موبايل ضيّق (320×640، أصغر
//      جهاز أندرويد حقيقي لسه مستخدم)، موبايل عادي (412×915)، وتابلت (800×1280).
//
// شغّله بـ:
//   flutter test test_live/all_screens_smoke_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';

import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/auth_repository.dart';
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/account/account_screen.dart';
import 'package:customer_app/features/addresses/addresses_screen.dart';
import 'package:customer_app/features/addresses/address_form_screen.dart';
import 'package:customer_app/features/addresses/addresses_repository.dart';
import 'package:customer_app/features/auth/login_screen.dart';
import 'package:customer_app/features/catalog/categories_screen.dart';
import 'package:customer_app/features/catalog/home_screen.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/search_results_screen.dart';
import 'package:customer_app/features/catalog/services_screen.dart';
import 'package:customer_app/features/chat/chat_screen.dart';
import 'package:customer_app/features/favorites/favorites_screen.dart';
import 'package:customer_app/features/legal/legal_links_screen.dart';
import 'package:customer_app/features/loyalty/loyalty_screen.dart';
import 'package:customer_app/features/notifications/notification_preferences_screen.dart';
import 'package:customer_app/features/notifications/notifications_screen.dart';
import 'package:customer_app/features/orders/job_details_screen.dart';
import 'package:customer_app/features/orders/order_detail_screen.dart';
import 'package:customer_app/features/orders/orders_screen.dart';
import 'package:customer_app/features/orders/schedule_selection_screen.dart';
import 'package:customer_app/features/payment_methods/payment_methods_screen.dart';
import 'package:customer_app/features/payments/fawry_reference_screen.dart';
import 'package:customer_app/features/payments/instapay_reference_screen.dart';
import 'package:customer_app/features/payments/payments_repository.dart';
import 'package:customer_app/features/payments/wallet_screen.dart';
import 'package:customer_app/features/projects/create_project_screen.dart';
import 'package:customer_app/features/projects/my_projects_screen.dart';
import 'package:customer_app/features/recurring/recurring_orders_screen.dart';
import 'package:customer_app/features/referrals/referrals_screen.dart';
import 'package:customer_app/features/support/complaints_screen.dart';
import 'package:customer_app/features/support/file_complaint_screen.dart';
import 'package:customer_app/features/support/support_contact_screen.dart';
import 'package:customer_app/features/technician_referral/technician_referral_screen.dart';
import 'package:customer_app/features/technicians/technician_selection_screen.dart';
import 'package:customer_app/features/tracking/tracking_screen.dart';
import 'package:customer_app/features/warranty/warranties_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import '_live_support.dart';

/// جلسة حقيقية بلا `flutter_secure_storage` — القناة بتاعته مش موجودة جوّه
/// `TestWidgetsFlutterBinding`، فبناء `AuthRepository` عادي وندائه `init()` بيرمي
/// `MissingPluginException`. البديل ده بيمسك التوكن في الذاكرة وبيوجّه كل نداء موثّق
/// لنفس `api_client` اللي التطبيق الحقيقي بيستخدمه — يعني الشاشات بتشوف **بيانات حقيقية**.
class _LiveAuth extends AuthRepository {
  _LiveAuth(this._token, this._user);

  final String _token;
  final BaytakUser _user;

  @override
  String? get accessToken => _token;
  @override
  BaytakUser? get user => _user;
  @override
  bool get isAuthenticated => true;
  @override
  bool get isLoading => false;

  @override
  Future<Map<String, dynamic>?> authedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? extraHeaders,
  }) =>
      apiRequest(method, path, body: body, accessToken: _token, extraHeaders: extraHeaders);

  @override
  Future<List<Map<String, dynamic>>> authedRequestList(String path) =>
      apiRequestList(path, accessToken: _token);

  @override
  Future<ApiPage> authedRequestPage(String path) => apiRequestPage(path, accessToken: _token);

  @override
  Future<Map<String, dynamic>?> authedUpload(
    String path, {
    required List<int> fileBytes,
    required String filename,
    Map<String, String> fields = const {},
  }) =>
      apiUpload(path, fileBytes: fileBytes, filename: filename, fields: fields, accessToken: _token);
}

/// المقاسات اللي كل شاشة لازم تشتغل عليها. الضيّق (320) مقصود: هو اللي بيكشف الـoverflow
/// اللي المالك بيشوفه على أجهزة حقيقية والاختبارات العادية (800×600 الافتراضي) بتخبّيه.
const _viewports = <String, Size>{
  'موبايل ضيّق 320×640': Size(320, 640),
  'موبايل عادي 412×915': Size(412, 915),
  'تابلت 800×1280': Size(800, 1280),
};

late AuthRepository auth;
late String orderId;
late String orderNumber;
late CatalogService service;
late ServiceCategory category;

Future<void> _pumpScreen(WidgetTester tester, Widget screen, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ChangeNotifierProvider<AuthRepository>.value(
      value: auth,
      child: MaterialApp(
        theme: AppTheme.light(),
        locale: const Locale('ar', 'EG'),
        home: Directionality(textDirection: TextDirection.rtl, child: screen),
      ),
    ),
  );

  // **`runAsync` مش `pumpAndSettle`**: `testWidgets` بيشغّل الاختبار جوّه `FakeAsync`، فأي
  // I/O حقيقي (نداء HTTP) مابيخلصش أبدًا جوّه الزمن الوهمي — الشاشة تفضل على التحميل
  // «فشل كاذب». `runAsync` بيرجّع الزمن الحقيقي للحظة، فالنداء بيكمّل فعلاً، وبعدين
  // `pump()` بيرسم الإطار الجديد. وpumpAndSettle نفسها ماينفعش: شاشات فيها مؤقتات دورية
  // أو سوكيت حي مابتستقرش أبدًا.
  for (var i = 0; i < 16; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
    await tester.pump(const Duration(milliseconds: 250));
    final err = tester.takeException();
    if (err != null) {
      // الرسالة لوحدها بتقول «overflowed by N pixels» من غير ما تقول **فين**. الدَمب ده
      // بيطبع الويدجت المسؤولة وملفها وسطرها — من غيره الإصلاح بيبقى تخمين.
      if (err.toString().contains('overflowed')) {
        // شجرة الرندر بتوسم أي RenderFlex متجاوز بـ«OVERFLOWING» — ده اللي بيقول **فين**
        // بالظبط، لأن نص الاستثناء لوحده بيقول «كام بيكسل» بس.
        debugDumpRenderTree();
      }
      throw err;
    }
  }
}

/// تفكيك الشجرة بعد الفحص — من غيره أي `Timer.periodic` جوّه شاشة بيفضل شغّال والـbinding
/// بيرمي `!timersPending`، وهو فشل بنية اختبار مش بَقّة في الشاشة.
Future<void> _disposeTree(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
  // شاشات ليها إعادة محاولة مؤجّلة مشروعة (مثال: التقاط موقع الفني بعد ٣ و٨ ثواني) —
  // بنصرّف الزمن الوهمي عشان مؤقتاتها تنطلق وتلاقي `mounted == false` وتخرج. من غير كده
  // الـbinding بيرمي `!timersPending` وهو عطل بنية اختبار مش عطل منتج.
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(seconds: 3));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
  }
  await tester.pump();
  tester.takeException();
}

/// «الشاشة لسه بتحمّل؟» — وجود مؤشر تحميل **بعد** ما إدّيناها ٦ ثواني على شبكة محلية معناه
/// إنها عالقة، وده بالظبط عرَض بَقّة «طلباتي».
bool _stillLoading(WidgetTester tester) {
  for (final element in find.byType(CircularProgressIndicator).evaluate()) {
    final size = element.size;
    // المؤشرات الصغيرة (٢٠×٢٠ جوّه زرار «بيتحمّل») حالة طبيعية ومقصودة. اللي بيهمنا هو
    // مؤشر بالحجم الافتراضي (٣٦) اللي بيبقى **هو كل محتوى الشاشة** — ده عرَض «الصفحة
    // ما بتفتحش».
    if (size != null && size.width >= 30 && size.height >= 30) return true;
  }
  return false;
}

void main() {
  setUpAll(() async {
    // `flutter_test` بيركّب HttpClient وهمي بيرجّع 400 لأي نداء. تصفيره بيرجّع الشبكة
    // الحقيقية، وده الفرق بين «اختبار شاشات» و«اختبار شاشات ببيانات حقيقية».
    HttpOverrides.global = null;

    // `flutter_secure_storage` قناة أصلية مالهاش تنفيذ في بيئة الاختبار — من غير البديل ده
    // أي شاشة بتقرا التخزين الآمن (حسابي، البصمة) بترمي MissingPluginException، وهو عطل بيئة
    // مش عطل منتج. بنرد بقيم فاضية = «مفيش جلسة محفوظة»، وهي الحالة الحقيقية لجهاز جديد.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (call) async => switch (call.method) {
        'readAll' => <String, String>{},
        'containsKey' => false,
        _ => null,
      },
    );

    final phone = uniquePhone();
    final token = await registerCustomer(phone, fullName: 'مسح الشاشات');
    final me = await apiRequest('GET', '/auth/me', accessToken: token);
    auth = _LiveAuth(token, BaytakUser.fromJson(me!));

    final cities = await apiRequestList('/cities');
    final cityId = cities.first['id'] as String;
    final areas = await apiRequestList('/cities/$cityId/areas');
    final address = await apiRequest('POST', '/addresses', accessToken: token, body: {
      'city_id': cityId,
      'area_id': areas.first['id'],
      'street_name': 'شارع مسح الشاشات',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'مسح الشاشات',
    });

    final categories = await apiRequestList('/service-categories');
    Map<String, dynamic>? pickedCategory;
    Map<String, dynamic>? pickedService;
    for (final c in categories) {
      final services = await apiRequestList('/services?category_id=${c['id']}');
      if (services.isNotEmpty) {
        pickedCategory = c;
        pickedService = services.first;
        break;
      }
    }
    category = ServiceCategory.fromJson(pickedCategory!);
    // الخدمة من مسار التفاصيل مش من القايمة: القايمة عقد مختصر، والشاشات بتعتمد على الحقول
    // الكاملة (الحقول الديناميكية، سياسة المسار، الإضافات).
    service = CatalogService.fromJson(
      (await apiRequest('GET', '/services/${pickedService!['id']}'))!,
    );

    final order = await apiRequest('POST', '/orders', accessToken: token, body: {
      'service_id': service.id,
      'address_id': address!['id'],
      'problem_description': 'مسح الشاشات — طلب اختبار',
    });
    orderId = order!['id'] as String;
    orderNumber = order['order_number'] as String;
  });

  /// كل شاشة بتتسجّل مرة واحدة هنا وبتتشغّل على كل المقاسات.
  final screens = <String, Widget Function()>{
    'الرئيسية': () => const HomeScreen(),
    'الفئات': () => const CategoriesScreen(),
    'خدمات فئة': () => ServicesScreen(category: category),
    'نتائج البحث': () => const SearchResultsScreen(initialQuery: 'كهرباء'),
    'طلباتي': () => const OrdersScreen(),
    'تفاصيل الطلب': () => OrderDetailScreen(orderId: orderId),
    'تفاصيل الشغلانة قبل الحجز': () => JobDetailsScreen(service: service),
    'اختيار الموعد': () => const ScheduleSelectionScreen(allowsDateRangeBooking: true),
    'اختيار الفني': () => TechnicianSelectionScreen(service: service),
    'الشات': () => ChatScreen(orderId: orderId),
    'تتبع الطلب': () => TrackingScreen(orderId: orderId, orderNumber: orderNumber),
    'العناوين': () => const AddressesScreen(),
    'إضافة عنوان': () => AddressFormScreen(repository: AddressesRepository(auth)),
    'حسابي': () => const AccountScreen(),
    'المحفظة': () => const WalletScreen(),
    'وسائل الدفع': () => const PaymentMethodsScreen(),
    'مرجع فوري': () => FawryReferenceScreen(
          orderId: orderId,
          reference: FawryReference(
            referenceNumber: '1234567890',
            expiresAt: DateTime.now().add(const Duration(days: 2)),
          ),
        ),
    'مرجع إنستاباي': () => InstaPayReferenceScreen(
          orderId: orderId,
          reference: InstaPayReference(
            referenceCode: 'REF-123456',
            instructionsAr: 'حوّل المبلغ على الرقم ده وارفع صورة التحويل',
          ),
        ),
    'الإشعارات': () => const NotificationsScreen(),
    'تفضيلات الإشعارات': () => const NotificationPreferencesScreen(),
    'المفضّلة': () => const FavoritesScreen(),
    'الولاء': () => const LoyaltyScreen(),
    'الترشيحات': () => const ReferralsScreen(),
    'ترشيح فني': () => const TechnicianReferralScreen(),
    'ضماناتي': () => const WarrantiesScreen(),
    'الحجوزات المتكررة': () => const RecurringOrdersScreen(),
    'مشاريعي': () => const MyProjectsScreen(),
    'مشروع جديد': () => CreateProjectScreen(auth: auth),
    'الشكاوى': () => const ComplaintsScreen(),
    'تقديم شكوى': () => const FileComplaintScreen(),
    'التواصل مع الدعم': () => const SupportContactScreen(),
    'الشروط والسياسات': () => const LegalLinksScreen(),
    'تسجيل الدخول': () => const LoginScreen(),
  };

  screens.forEach((name, build) {
    for (final entry in _viewports.entries) {
      testWidgets('$name — ${entry.key}', (tester) async {
        await _pumpScreen(tester, build(), entry.value);
        final stuck = _stillLoading(tester);
        await _disposeTree(tester);
        expect(
          stuck,
          isFalse,
          reason: 'شاشة «$name» لسه على مؤشر التحميل بعد ٤ ثواني — دي نفس حالة بَقّة «طلباتي»',
        );
      }, timeout: const Timeout(Duration(seconds: 120)));
    }
  });
}
