// **مسح كل شاشة الفني** — ضد `apps/api` الشغّال فعلاً، ببيانات حقيقية، على تلات مقاسات.
//
// نسخة مطابقة في الفلسفة لـ`apps/customer-app/test_live/all_screens_smoke_live_test.dart`
// (طلب المالك 2026-09-10: «كل الواجهات اللي الكاستمر ينفع يشوفها **وكمان الصنايعي**»).
//
// كل حالة بتفشل لو:
//   ١. أي استثناء اترمى أثناء البناء أو بعده (ومعاه `debugDumpRenderTree()` لو overflow).
//   ٢. الشاشة فضلت على مؤشر تحميل **بحجم كامل** بعد ٤ ثواني — عرَض «الصفحة ما بتفتحش».
//   ٣. أي `RenderFlex overflowed` على ٣٢٠×٦٤٠ أو ٤١٢×٩١٥ أو ٨٠٠×١٢٨٠.
//
// شغّله بـ:
//   node scripts/seed-technician-screens.js /tmp/tech-seed.json
//   flutter test test_live/all_screens_smoke_live_test.dart \
//     --dart-define=API_BASE_URL=http://localhost:3000/api/v1 \
//     --dart-define=REALTIME_ENABLED=false \
//     --dart-define=TECH_SEED_PATH=/tmp/tech-seed.json
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/auth_repository.dart';
import 'package:technician_app/design/app_theme.dart';
import 'package:technician_app/features/academy/academy_screen.dart';
import 'package:technician_app/features/assistant_offers/assistant_offers_screen.dart';
import 'package:technician_app/features/auth/login_screen.dart';
import 'package:technician_app/features/chat/chat_screen.dart';
import 'package:technician_app/features/company/company_screen.dart';
import 'package:technician_app/features/earnings/earnings_repository.dart';
import 'package:technician_app/features/earnings/monthly_statement_screen.dart';
import 'package:technician_app/features/earnings/payout_request_screen.dart';
import 'package:technician_app/features/earnings/payouts_screen.dart';
import 'package:technician_app/features/earnings/wallet_screen.dart';
import 'package:technician_app/features/internal_chat/internal_chat_list_screen.dart';
import 'package:technician_app/features/kpi/kpi_screen.dart';
import 'package:technician_app/features/legal/legal_links_screen.dart';
import 'package:technician_app/features/notifications/notification_preferences_screen.dart';
import 'package:technician_app/features/notifications/notifications_screen.dart';
import 'package:technician_app/features/onboarding/onboarding_screen.dart';
import 'package:technician_app/features/orders/available_orders_screen.dart';
import 'package:technician_app/features/orders/order.dart';
import 'package:technician_app/features/orders/order_execution_screen.dart';
import 'package:technician_app/features/orders/recruit_team_screen.dart';
import 'package:technician_app/features/portfolio/portfolio_screen.dart';
import 'package:technician_app/features/preferred_crew/preferred_crew_screen.dart';
import 'package:technician_app/features/profile/profile_screen.dart';
import 'package:technician_app/features/progression/progression_screen.dart';
import 'package:technician_app/features/referrals/referral_screen.dart';
import 'package:technician_app/features/schedule/schedule_screen.dart';
import 'package:technician_app/features/skills/skills_screen.dart';
import 'package:technician_app/features/support/complaints_screen.dart';
import 'package:technician_app/features/support/file_complaint_screen.dart';
import 'package:technician_app/features/support/support_contact_screen.dart';

const _seedPath = String.fromEnvironment('TECH_SEED_PATH', defaultValue: '/tmp/tech-seed.json');

/// جلسة فني حقيقية بلا `flutter_secure_storage` — نفس سبب النسخة في تطبيق العميل بالحرف.
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
  Future<Map<String, dynamic>?> authedRequest(String method, String path, {Map<String, dynamic>? body}) =>
      apiRequest(method, path, body: body, accessToken: _token);

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

const _viewports = <String, Size>{
  'موبايل ضيّق 320×640': Size(320, 640),
  'موبايل عادي 412×915': Size(412, 915),
  'تابلت 800×1280': Size(800, 1280),
};

late AuthRepository auth;
late EarningsRepository earnings;
late Order order;
late String orderId;

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

  // `runAsync` لأن `testWidgets` بيشتغل جوّه `FakeAsync` وأي I/O حقيقي مابيخلصش فيه.
  for (var i = 0; i < 16; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
    await tester.pump(const Duration(milliseconds: 250));
    final err = tester.takeException();
    if (err != null) {
      if (err.toString().contains('overflowed')) debugDumpRenderTree();
      throw err;
    }
  }
}

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

bool _stillLoading(WidgetTester tester) {
  for (final element in find.byType(CircularProgressIndicator).evaluate()) {
    final size = element.size;
    if (size != null && size.width >= 30 && size.height >= 30) return true;
  }
  return false;
}

void main() {
  setUpAll(() async {
    HttpOverrides.global = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (call) async => switch (call.method) {
        'readAll' => <String, String>{},
        'containsKey' => false,
        _ => null,
      },
    );

    final seedFile = File(_seedPath);
    if (!seedFile.existsSync()) {
      throw StateError('مالقيتش بذرة الفني في $_seedPath — شغّل scripts/seed-technician-screens.js الأول');
    }
    final seed = jsonDecode(seedFile.readAsStringSync()) as Map<String, dynamic>;
    final token = seed['technicianToken'] as String;
    orderId = seed['orderId'] as String;

    final me = await apiRequest('GET', '/auth/me', accessToken: token);
    auth = _LiveAuth(token, BaytakUser.fromJson(me!));
    earnings = EarningsRepository(auth);
    order = Order.fromJson((await apiRequest('GET', '/technician/orders/$orderId', accessToken: token))!);
  });

  final screens = <String, Widget Function()>{
    'الطلبات المتاحة (الرئيسية)': () => const AvailableOrdersScreen(),
    'تنفيذ الطلب': () => OrderExecutionScreen(initialOrder: order),
    'الشات مع العميل': () => ChatScreen(orderId: orderId),
    'تجنيد فريق': () => RecruitTeamScreen(orderId: orderId, role: 'technician'),
    'الجدول': () => const ScheduleScreen(),
    'المحفظة': () => const WalletScreen(),
    'كشف الشهر': () => MonthlyStatementScreen(auth: auth),
    'طلبات الصرف': () => PayoutsScreen(repository: earnings),
    'طلب صرف جديد': () => PayoutRequestScreen(repository: earnings, availableBalanceCents: 50000),
    'مؤشرات الأداء': () => const KpiScreen(),
    'الترقّي': () => const ProgressionScreen(),
    'المهارات': () => const SkillsScreen(),
    'الأكاديمية': () => const AcademyScreen(),
    'معرض الأعمال': () => const PortfolioScreen(),
    'طاقمي المفضّل': () => const PreferredCrewScreen(),
    'عروض المساعدة': () => const AssistantOffersScreen(),
    'الشركة': () => const CompanyScreen(),
    'الترشيحات': () => const ReferralScreen(),
    'البروفايل': () => const ProfileScreen(),
    'الإشعارات': () => const NotificationsScreen(),
    'تفضيلات الإشعارات': () => const NotificationPreferencesScreen(),
    'محادثات الإدارة': () => const InternalChatListScreen(),
    'الشكاوى': () => const ComplaintsScreen(),
    'تقديم شكوى': () => const FileComplaintScreen(),
    'التواصل مع الدعم': () => const SupportContactScreen(),
    'الشروط والسياسات': () => const LegalLinksScreen(),
    'الانضمام (Onboarding)': () => const OnboardingScreen(),
    'تسجيل الدخول': () => const LoginScreen(),
  };

  screens.forEach((name, build) {
    for (final entry in _viewports.entries) {
      testWidgets('$name — ${entry.key}', (tester) async {
        await _pumpScreen(tester, build(), entry.value);
        final stuck = _stillLoading(tester);
        await _disposeTree(tester);
        expect(stuck, isFalse, reason: 'شاشة «$name» لسه على مؤشر التحميل بعد ٤ ثواني');
      }, timeout: const Timeout(Duration(seconds: 120)));
    }
  });
}
