import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api_config.dart';
import 'core/api_exception.dart';
import 'core/auth_repository.dart';
import 'core/compromised_device_screen.dart';
import 'core/deep_link_router.dart';
import 'core/device_security.dart';
import 'design/app_theme.dart';
import 'features/auth/biometric_unlock_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/onboarding/onboarding_repository.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/notifications/floating_notification_alert.dart';
import 'features/orders/available_orders_screen.dart';
import 'features/tracking/tracking_client.dart';

void main() {
  assertProductionApiConfig();
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
        navigatorKey: rootNavigatorKey,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        locale: const Locale('ar', 'EG'),
        builder: (context, child) {
          final auth = context.watch<AuthRepository>();
          return Stack(
            children: [
              child ?? const SizedBox.shrink(),
              if (auth.isAuthenticated && !auth.biometricUnlockPending)
                const PositionedDirectional(end: 16, bottom: 88, child: FloatingNotificationAlert()),
            ],
          );
        },
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

// بَقّة حقيقية اتلقطت (بلاغ المالك، 2026-08-21): "أونلاين دلوقتي" (docs/08 §35.10، ADR-0021 §6)
// كان دايمًا بيظهر "أوفلاين" لكل الفنيين — مش بَقّة في RealtimeSessionRegistry نفسه (تسجيل
// الـuserId ونفس المفتاح في القراءة سليمين)، المشكلة إن التطبيق ماكانش بيفتح أي اتصال Socket.IO
// خالص لحد ما فني يفتح شاشة تنفيذ طلب نشط (`order_execution_screen.dart`'s
// TechnicianTrackingClient) — فني مسجّل دخول وقاعد على الشاشة الرئيسية بلا طلب نشط معندوش أي
// socket خالص، فـisUserOnline() بترجع false بحق. الإصلاح: اتصال "حضور" مستقل (نفس namespace
// `/tracking`، بلا orderId — التسجيل في RealtimeSessionRegistry بيحصل وقت handleConnection قبل
// أي انضمام لغرفة، فمفيش داعي لـorder_id خالص) بيتفتح طول ما الفني مسجّل دخول والتطبيق في
// المقدمة، منفصل تمامًا عن اتصال تتبع الطلب (الاتنين ممكن يشتغلوا مع بعض — الـregistry بيدعم
// أكتر من socket لكل user_id، Set مش قيمة واحدة).
class _AuthGate extends StatefulWidget {
  const _AuthGate();

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> with WidgetsBindingObserver {
  final _presence = TechnicianTrackingClient();
  bool _presenceConnected = false;
  AuthRepository? _auth;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = context.read<AuthRepository>();
    if (!identical(auth, _auth)) {
      _auth?.removeListener(_syncPresence);
      _auth = auth;
      _auth!.addListener(_syncPresence);
      _syncPresence();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _syncPresence();
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      _disconnectPresence();
    }
  }

  void _syncPresence() {
    final auth = _auth;
    if (auth == null) return;
    if (auth.isAuthenticated && !_presenceConnected) {
      _presence.connect(accessToken: auth.accessToken!);
      _presenceConnected = true;
    } else if (!auth.isAuthenticated) {
      _disconnectPresence();
    }
  }

  void _disconnectPresence() {
    if (!_presenceConnected) return;
    _presence.dispose();
    _presenceConnected = false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _auth?.removeListener(_syncPresence);
    _presence.dispose();
    super.dispose();
  }

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
    if (!auth.isAuthenticated) return const LoginScreen();
    // مزوّد خدمة واحد موحّد (ADR-0031) — صفر تفرّع بعد الدخول حسب نوع حساب: كل فني (بما فيهم
    // الشغالة/المربية، بقت تسجّل بنفس المسار بالظبط) بيعدّي نفس بوابة الاعتماد (KYC كامل).
    return const _VerificationGate();
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
