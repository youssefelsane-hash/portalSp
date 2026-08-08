import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/auth_repository.dart';
import 'core/compromised_device_screen.dart';
import 'core/device_security.dart';
import 'features/auth/login_screen.dart';
import 'features/orders/available_orders_screen.dart';

void main() {
  runApp(const BaytakTechnicianApp());
}

class BaytakTechnicianApp extends StatelessWidget {
  const BaytakTechnicianApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthRepository()..init(),
      child: MaterialApp(
        title: 'baytak — الفني',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal), useMaterial3: true),
        locale: const Locale('ar', 'EG'),
        home: const _DeviceSecurityGate(),
      ),
    );
  }
}

// أول بوابة قبل أي حاجة تانية — فحص سلامة الجهاز (root/jailbreak) قبل حتى شاشة الدخول، عشان
// فني على جهاز مخترق ميقدرش يوصل لأي بيانات مالية حتى لو مسجّل دخول بالفعل (توكن محفوظ محلياً).
class _DeviceSecurityGate extends StatelessWidget {
  const _DeviceSecurityGate();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<DeviceSecurityResult>(
      future: DeviceSecurityService().check(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final result = snapshot.data!;
        if (result.isCompromised) {
          return CompromisedDeviceScreen(reasonAr: result.reasonAr ?? 'الجهاز ده مش آمن.');
        }
        return const _AuthGate();
      },
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
    return auth.isAuthenticated ? const AvailableOrdersScreen() : const LoginScreen();
  }
}
