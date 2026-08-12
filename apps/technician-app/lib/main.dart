import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api_exception.dart';
import 'core/auth_repository.dart';
import 'core/compromised_device_screen.dart';
import 'core/device_security.dart';
import 'features/auth/login_screen.dart';
import 'features/onboarding/onboarding_repository.dart';
import 'features/onboarding/onboarding_screen.dart';
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
        title: 'صُنّاع — الفني',
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
    return auth.isAuthenticated ? const _VerificationGate() : const LoginScreen();
  }
}

// اعتماد الفني الجديد (docs/02 §technician_profiles.verification_status) — كانت فجوة موثّقة
// صراحة: أي فني مسجّل دخول (حتى لو لسه pending) كان بيوصل مباشرة لـAvailableOrdersScreen
// الفاضية للأبد. بنفحص verification_status مرة واحدة بعد تسجيل الدخول ونوجّه على أساسه.
// **فشل آمن متعمّد**: لو فشل الفحص (مشكلة شبكة عابرة)، بنفضّل AvailableOrdersScreen العادية —
// مش قفل الفني بره التطبيق كله بسبب خطأ تقني، ومطابقة الباك-إند (matching.service.ts) أصلاً
// بترفض أي فني verification_status != approved بغض النظر عن أي حاجة بتحصل هنا في العميل.
class _VerificationGate extends StatefulWidget {
  const _VerificationGate();

  @override
  State<_VerificationGate> createState() => _VerificationGateState();
}

class _VerificationGateState extends State<_VerificationGate> {
  bool _loading = true;
  bool _needsOnboarding = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final me = await OnboardingRepository(context.read<AuthRepository>()).fetchMe();
      if (mounted) setState(() => _needsOnboarding = me.verificationStatus != 'approved');
    } on ApiException {
      // فشل آمن — راجع تعليق الكلاس فوق.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return _needsOnboarding ? const OnboardingScreen() : const AvailableOrdersScreen();
  }
}
