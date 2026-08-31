import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api_config.dart';
import 'core/auth_repository.dart';
import 'core/deep_link_router.dart';
import 'design/app_theme.dart';
import 'design/desktop_app_frame.dart';
import 'features/auth/biometric_unlock_screen.dart';
import 'features/shell/customer_shell.dart';
import 'features/notifications/floating_notification_alert.dart';

void main() {
  assertProductionApiConfig();
  runApp(const BaytakApp());
}

class BaytakApp extends StatelessWidget {
  const BaytakApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthRepository()..init(),
      child: MaterialApp(
        title: 'أسطى',
        debugShowCheckedModeBanner: false,
        navigatorKey: rootNavigatorKey,
        // docs/08 §108-E — بيخلي الزرار العايم للإشعارات يختفي مؤقتًا لما أي dialog/bottom-sheet
        // يفتح، بدل ما يتغطى فوقها أو يغطّي زرار "موافق" بتاعتها. راجع
        // NotificationAlertPopupObserver في floating_notification_alert.dart.
        navigatorObservers: [NotificationAlertPopupObserver()],
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        locale: const Locale('ar', 'EG'),
        builder: (context, child) {
          final auth = context.watch<AuthRepository>();
          return Stack(
            children: [
              DesktopAppFrame(child: child ?? const SizedBox.shrink()),
              if (auth.isAuthenticated && !auth.biometricUnlockPending)
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
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    // docs/08 §17.22 — لازم يتفحص *قبل* isAuthenticated: جلسة محفوظة مش كافية لوحدها لو
    // البصمة مفعّلة على الجهاز ده.
    if (auth.biometricUnlockPending) {
      return const BiometricUnlockScreen();
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
