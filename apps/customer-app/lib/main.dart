import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api_config.dart';
import 'core/auth_repository.dart';
import 'core/deep_link_router.dart';
import 'design/app_theme.dart';
import 'features/auth/biometric_unlock_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/catalog/booking_mode_screen.dart';

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
        title: 'صُنّاع',
        debugShowCheckedModeBanner: false,
        navigatorKey: rootNavigatorKey,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        locale: const Locale('ar', 'EG'),
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
    return auth.isAuthenticated ? const BookingModeScreen() : const LoginScreen();
  }
}
