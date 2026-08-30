import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController(text: '+20');
  final _otpController = TextEditingController();
  final _fullNameController = TextEditingController();
  bool _otpSent = false;
  bool _isSubmitting = false;
  String? _error;
  // تسجيل فني جديد (كانت فجوة موثّقة صراحة) — نفس الشاشة، مود مختلف بس. الفرق: OTP بـ
  // purpose=register بدل login، وخطوة إضافية للاسم الكامل، ونداء register() بدل verifyOtp().
  bool _isRegisterMode = false;
  // لو الفني حاول "دخول" برقم مش مسجّل، الباك-إند بيرفض برسالة واضحة — بدل ما نسيبه يعلق،
  // نعرضله اقتراح مباشر يحوّله لمود التسجيل بنفس الرقم من غير ما يكتبه تاني.
  bool _suggestRegister = false;

  /// §106 — «ابعت الكود تاني» بعدّاد تنازلي. قبل كده خطوة الكود مكانش فيها إعادة إرسال خالص:
  /// أي كود بايظ/منتهي (والسيرفر بيلغي القديم أول ما يتصدر جديد) كان بيحوّل الشاشة لطريق
  /// مسدود، والمخرج الوحيد «رقم موبايل غلط؟ رجّع خطوة» — رسالة محدش هيدوس عليها والرقم صح.
  final _otpFocusNode = FocusNode();
  int _resendSeconds = 0;
  Timer? _resendTimer;

  @override
  void dispose() {
    _resendTimer?.cancel();
    _otpFocusNode.dispose();
    _phoneController.dispose();
    _otpController.dispose();
    _fullNameController.dispose();
    super.dispose();
  }

  /// مهلة بين طلبين — الباك-إند نفسه بيقفل عند ٥ طلبات/دقيقة (`@Throttle` على
  /// `POST /auth/otp/request`)، فالعدّاد هنا بيمنع الفني يوصل للحظر أصلاً بدل ما يتفاجئ بيه.
  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _resendSeconds -= 1);
      if (_resendSeconds <= 0) timer.cancel();
    });
  }

  Future<void> _resendOtp() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
      _suggestRegister = false;
    });
    try {
      await context.read<AuthRepository>().requestOtp(
            _phoneController.text.trim(),
            purpose: _isRegisterMode ? 'register' : 'login',
          );
      if (!mounted) return;
      // الكود القديم بقى ملغي فعليًا على السيرفر — لازم الخانة تتفضّى، وإلا الفني هيضغط «دخول»
      // على كود ميت ويحرق محاولة من الخمسة بلا داعي.
      _otpController.clear();
      _startResendCooldown();
      _otpFocusNode.requestFocus();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('بعتنالك كود جديد — الكود القديم بقى لاغي')),
      );
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _requestOtp() async {
    if (_isRegisterMode && _fullNameController.text.trim().length < 2) {
      setState(() => _error = 'اكتب اسمك الكامل الأول');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
      _suggestRegister = false;
    });
    try {
      await context.read<AuthRepository>().requestOtp(
            _phoneController.text.trim(),
            purpose: _isRegisterMode ? 'register' : 'login',
          );
      setState(() => _otpSent = true);
      _startResendCooldown();
    } on ApiException catch (err) {
      setState(() => _error = err.message);
    } finally {
      setState(() => _isSubmitting = false);
    }
  }

  Future<void> _verifyOtp() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
      _suggestRegister = false;
    });
    try {
      final auth = context.read<AuthRepository>();
      if (_isRegisterMode) {
        await auth.register(
          _phoneController.text.trim(),
          _otpController.text.trim(),
          _fullNameController.text.trim(),
          userType: 'technician',
        );
      } else {
        await auth.verifyOtp(_phoneController.text.trim(), _otpController.text.trim());
      }
    } on ApiException catch (err) {
      // "الرقم ده مش مسجل، سجّل حساب جديد الأول" — نفس رسالة auth.service.ts's login() بالحرف.
      final suggestRegister = !_isRegisterMode && err.statusCode == 404;
      // الخانة بتتفضّى وتاخد التركيز تاني — الكود اللي اترفض مش هينفع تاني مهما اتبعت، وسيبانه
      // مكتوب أسرع طريقة يستهلك بيها الفني محاولاته الخمسة بلا فايدة.
      _otpController.clear();
      setState(() {
        _error = err.message;
        _suggestRegister = suggestRegister;
      });
      if (!suggestRegister) _otpFocusNode.requestFocus();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// الرجوع لخطوة الرقم بيوقف العدّاد — تايمر دوري بيعمل rebuild كل ثانية لخطوة مش ظاهرة أصلاً.
  void _backToPhoneStep() {
    _resendTimer?.cancel();
    setState(() {
      _otpSent = false;
      _resendSeconds = 0;
    });
  }

  void _switchToRegister() {
    _resendTimer?.cancel();
    setState(() {
      _resendSeconds = 0;
      _isRegisterMode = true;
      _otpSent = false;
      _otpController.clear();
      _error = null;
      _suggestRegister = false;
    });
  }

  void _toggleMode() {
    _resendTimer?.cancel();
    setState(() {
      _resendSeconds = 0;
      _isRegisterMode = !_isRegisterMode;
      _otpSent = false;
      _otpController.clear();
      _fullNameController.clear();
      _error = null;
      _suggestRegister = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('أسطى', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    _otpSent
                        ? 'اتبعت كود لـ ${_phoneController.text}'
                        : (_isRegisterMode ? 'اعمل حساب فني جديد' : 'ادخل رقم موبايلك عشان تكمل'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 24),
                  if (!_otpSent) ...[
                    if (_isRegisterMode) ...[
                      TextField(
                        controller: _fullNameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(labelText: 'الاسم الكامل'),
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      textDirection: TextDirection.ltr,
                      decoration: const InputDecoration(labelText: 'رقم الموبايل', hintText: '+201001234567'),
                    ),
                  ] else ...[
                    TextField(
                      controller: _otpController,
                      focusNode: _otpFocusNode,
                      keyboardType: TextInputType.number,
                      textDirection: TextDirection.ltr,
                      maxLength: 6,
                      decoration: const InputDecoration(labelText: 'كود التحقق (6 أرقام)'),
                    ),
                    TextButton(
                      key: const ValueKey('otp-resend'),
                      onPressed: (_isSubmitting || _resendSeconds > 0) ? null : _resendOtp,
                      child: Text(
                        _resendSeconds > 0
                            ? 'تقدر تطلب كود جديد بعد $_resendSeconds ثانية'
                            : 'ما وصلكش الكود؟ ابعته تاني',
                      ),
                    ),
                    TextButton(
                      onPressed: _isSubmitting ? null : _backToPhoneStep,
                      child: const Text('رقم موبايل غلط؟ رجّع خطوة'),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  if (_suggestRegister) ...[
                    const SizedBox(height: 4),
                    TextButton(
                      onPressed: _isSubmitting ? null : _switchToRegister,
                      child: const Text('سجّل حساب فني جديد بنفس الرقم'),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _isSubmitting ? null : (_otpSent ? _verifyOtp : _requestOtp),
                    child: Text(
                      _isSubmitting
                          ? 'جاري التحميل…'
                          : (_otpSent ? (_isRegisterMode ? 'إنشاء الحساب' : 'دخول') : 'ابعت كود التحقق'),
                    ),
                  ),
                  if (!_otpSent) ...[
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: _isSubmitting ? null : _toggleMode,
                      child: Text(_isRegisterMode ? 'عندك حساب؟ سجّل دخول' : 'فني جديد؟ سجّل حساب'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
