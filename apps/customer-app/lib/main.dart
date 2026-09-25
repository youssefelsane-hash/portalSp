import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api_config.dart';
import 'core/auth_repository.dart';
import 'core/crash_reporting.dart';
import 'core/deep_link_router.dart';
import 'core/feature_flags.dart';
import 'core/push_notification_service.dart';
import 'features/catalog/branding_repository.dart';
import 'design/app_theme.dart';
import 'design/branded_loading_screen.dart';
import 'design/desktop_app_frame.dart';
import 'features/auth/biometric_unlock_screen.dart';
import 'features/auth/set_pin_screen.dart';
import 'features/shell/customer_shell.dart';
import 'features/notifications/floating_notification_alert.dart';
import 'features/ratings/pending_rating_prompt.dart';

void main() {
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      assertProductionApiConfig();
      await CrashReporting.initialize();
      PushNotificationService.installBackgroundHandler();
      // تسخين كاش البراند من أول لحظة: اللوجو بيتجاب مرة واحدة بالتوازي مع إقلاع الواجهة، فأي
      // شاشة بتعرضه (الدخول، شاشة التحميل، الرئيسية) بتلاقيه جاهز بدل ما تعرض بديل وتبدّله
      // قدام عين المستخدم. فشله متجاهَل عمدًا — البديل المرسوم بالكود شغّال بلا شبكة أصلاً.
      unawaited(
        BrandingRepository().fetchPrimaryLogo().catchError((_) => null),
      );
      runApp(const BaytakApp());
    },
    (error, stack) {
      unawaited(
        CrashReporting.recordError(
          error,
          stack,
          fatal: true,
          reason: 'uncaught zone error',
        ),
      );
    },
  );
}

class BaytakApp extends StatelessWidget {
  const BaytakApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthRepository()..init()),
        ChangeNotifierProxyProvider<AuthRepository, FeatureFlags>(
          create: (_) => FeatureFlags(),
          update: (_, auth, flags) => flags!..attach(auth),
        ),
      ],
      child: MaterialApp(
        title: 'Osta',
        debugShowCheckedModeBanner: false,
        navigatorKey: rootNavigatorKey,
        // docs/08 §108-E — بيخلي الزرار العايم للإشعارات يختفي مؤقتًا لما أي dialog/bottom-sheet
        // يفتح، بدل ما يتغطى فوقها أو يغطّي زرار "موافق" بتاعتها. راجع
        // NotificationAlertPopupObserver في floating_notification_alert.dart.
        navigatorObservers: [
          CrashReportingNavigatorObserver(),
          NotificationAlertPopupObserver(),
        ],
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        locale: const Locale('ar', 'EG'),
        builder: (context, child) {
          final auth = context.watch<AuthRepository>();
          final flags = context.watch<FeatureFlags>();
          return Stack(
            children: [
              DesktopAppFrame(child: child ?? const SizedBox.shrink()),
              if (auth.isAuthenticated &&
                  !auth.biometricUnlockPending &&
                  flags.isEnabled(
                    'customer_pending_rating_prompt',
                    fallback: true,
                  ))
                const PendingRatingPromptHost(),
              if (auth.isAuthenticated &&
                  !auth.biometricUnlockPending &&
                  flags.isEnabled(
                    'customer_floating_notification_alert',
                    fallback: true,
                  ))
                // الزر يظل فوق كل الصفحات، لكنه بلا Overlay أو Hero مستقلين حتى لا يتعارض
                // مع دورة حياة Navigator عند فتح شاشة جديدة.
                const PositionedDirectional(
                  end: 16,
                  bottom: 88,
                  child: FloatingNotificationAlertHost(),
                ),
            ],
          );
        },
        home: const _AuthGate(),
      ),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    if (auth.isLoading) {
      // مش `Scaffold` عريان: الإطار ده بيقع بين شاشة الدخول المُبرندة والقشرة المُبرندة،
      // وأي شاشة بلا هوية هنا بتتقري كـ«وميض بيكسلات غلط» (بلاغ مالك 2026-09-10).
      return const BrandedLoadingScreen(message: 'بنجهّز حسابك…');
    }
    // docs/08 §17.22 — لازم يتفحص *قبل* isAuthenticated: جلسة محفوظة مش كافية لوحدها لو
    // البصمة مفعّلة على الجهاز ده.
    if (auth.biometricUnlockPending) {
      return const BiometricUnlockScreen();
    }
    // **هجرة الـOTP → رمز الدخول (ADR-0109 §6-أ)**: مستخدم داخل بجلسة محفوظة من قبل التبديل
    // مالوش رمز. الشاشة دي **بتقفل** لأن الحساب في اللحظة دي مالوش **أي** credential: أول ما
    // الجلسة تنتهي يبقى مقفول برّه حسابه ومحتاج استرجاع من الأدمن. شاشة مرة واحدة أرخص من
    // تذكرة دعم لكل مستخدم قديم. الزائر مايشوفهاش (`isAuthenticated` شرط)، والحسابات الجديدة
    // بتخرج من التسجيل ومعاها رمز أصلاً فمابتشوفهاش خالص.
    if (auth.isAuthenticated && auth.user?.pinSet == false) {
      return const SetPinScreen(mode: SetPinMode.migration);
    }
    // **الزائر بيدخل عادي (docs/08 §77-B1، طلب مالك صريح)**: «مش لازم يعمل لوج إن أول ما يخش.
    // عادي الكاستمر بيخش يتفرج ويدوس على الكاتيجوريز».
    //
    // القشرة هي نقطة الدخول للاتنين — مسجّل وزائر. التسجيل بقى **مشروط بالفعل** (أول خطوة
    // حجز) مش بفتح التطبيق، عبر `ensureSignedIn()` في `core/auth_gate.dart`. وده اللي كل
    // تطبيقات الخدمات المعروفة بتعمله: الكتالوج قيمة بتتعرض قبل ما تطلب مقابل.
    //
    // **الباك-إند كان جاهز لده أصلاً** — كل مسارات الكتالوج `@Public()` من زمان، فالتغيير ده
    // صفر تغيير في الصلاحيات.
    return const CustomerShell();
  }
}
