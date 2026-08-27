import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/app_theme.dart';

/// شاشة الدخول/التسجيل.
///
/// **وضعان (docs/08 §77-B1)**:
///  - `isModal: false` (الافتراضي) — الشاشة الجذرية لما التطبيق يفتح على مستخدم مسجّل قبل كده
///    وجلسته انتهت. النجاح بيخلّي `_AuthGate` يعيد البناء لوحده، فمفيش pop.
///  - `isModal: true` — اتفتحت **جوّه** رحلة (زائر ضغط على خدمة). النجاح بيعمل `pop(true)`
///    عشان الرحلة تكمّل من نفس النقطة. ده جوهر طلب المالك: «أول ما يسجل تروح جاي الصفحة
///    أوتوماتيك مرجعة اللي هو كان بيعمله على طول».
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.isModal = false, this.headline});

  final bool isModal;

  /// سبب فتح الشاشة بكلام العميل («عشان تكمّل حجز سباكة») — بيظهر تحت العنوان في الوضع
  /// المشروط. رسالة عامة أضعف بكتير من رسالة بتقول له هو كان بيعمل إيه.
  final String? headline;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController(text: '+20');
  final _otpController = TextEditingController();
  final _fullNameController = TextEditingController();
  final _referralCodeController = TextEditingController();
  final _technicianReferralCodeController = TextEditingController();

  /// **طلب مالك صريح (docs/08 §77-B2)**: «أول ما يدوس التالي عايز أوتوماتيك الكيبورد يطلع…
  /// ويبقى البوينتر محطوط أوتوماتيك جوه الخانة». `autofocus` لوحده ما ينفعش هنا لأن الحقل
  /// بيتبنى في نفس الإطار اللي `_otpSent` بيتغيّر فيه — الحل `FocusNode` بيتطلب التركيز بعد
  /// ما الإطار يخلص.
  final _otpFocusNode = FocusNode();

  bool _otpSent = false;
  bool _isSubmitting = false;
  String? _error;
  // تسجيل عميل جديد (كانت فجوة موثّقة صراحة) — نفس الشاشة، مود مختلف بس. الفرق: OTP بـ
  // purpose=register بدل login، وخطوة إضافية للاسم الكامل، ونداء register() بدل verifyOtp().
  bool _isRegisterMode = false;
  // لو العميل حاول "دخول" برقم مش مسجّل، الباك-إند بيرفض برسالة واضحة — بدل ما نسيبه يعلق،
  // نعرضله اقتراح مباشر يحوّله لمود التسجيل بنفس الرقم من غير ما يكتبه تاني.
  bool _suggestRegister = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    _fullNameController.dispose();
    _referralCodeController.dispose();
    _technicianReferralCodeController.dispose();
    _otpFocusNode.dispose();
    super.dispose();
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
      // بعد ما الإطار اللي بيبني حقل الكود يخلص — قبل كده الحقل لسه مش موجود في الشجرة.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _otpFocusNode.requestFocus();
      });
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
          referralCode: _referralCodeController.text.trim(),
          technicianReferralCode: _technicianReferralCodeController.text.trim(),
        );
      } else {
        await auth.verifyOtp(_phoneController.text.trim(), _otpController.text.trim());
      }
      // في الوضع المشروط لازم نرجّع للرحلة اللي فتحتنا. في الوضع الجذري `_AuthGate` بيتكفّل.
      if (widget.isModal && mounted) Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      // "الرقم ده مش مسجل، سجّل حساب جديد الأول" — نفس رسالة auth.service.ts's login() بالحرف.
      final suggestRegister = !_isRegisterMode && err.statusCode == 404;
      setState(() {
        _error = err.message;
        _suggestRegister = suggestRegister;
      });
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _switchToRegister() {
    setState(() {
      _isRegisterMode = true;
      _otpSent = false;
      _otpController.clear();
      _error = null;
      _suggestRegister = false;
    });
  }

  void _toggleMode() {
    setState(() {
      _isRegisterMode = !_isRegisterMode;
      _otpSent = false;
      _otpController.clear();
      _fullNameController.clear();
      _referralCodeController.clear();
      _technicianReferralCodeController.clear();
      _error = null;
      _suggestRegister = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        // في الوضع المشروط بيبقى فيه زرار رجوع تلقائي — العميل لازم يقدر يرجع لتصفّحه.
        appBar: widget.isModal ? AppBar(title: const Text('تسجيل الدخول')) : null,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!widget.isModal) const _BrandMark(),
                    if (!widget.isModal) const SizedBox(height: 20),
                    Text(
                      widget.headline ??
                          (_isRegisterMode ? 'اعمل حساب جديد' : 'أهلًا بيك في صُنّاع'),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _otpSent
                          ? 'بعتنالك كود على ${_phoneController.text.trim()}'
                          : 'اكتب رقم موبايلك وهنبعتلك كود تأكيد',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (!_otpSent) ...[
                      if (_isRegisterMode) ...[
                        TextField(
                          controller: _fullNameController,
                          textCapitalization: TextCapitalization.words,
                          decoration: const InputDecoration(
                            labelText: 'الاسم الكامل',
                            prefixIcon: Icon(Icons.person_outline_rounded),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        textDirection: TextDirection.ltr,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _isSubmitting ? null : _requestOtp(),
                        decoration: const InputDecoration(
                          labelText: 'رقم الموبايل',
                          hintText: '+201001234567',
                          prefixIcon: Icon(Icons.phone_iphone_rounded),
                        ),
                      ),
                      if (_isRegisterMode) ...[
                        const SizedBox(height: 12),
                        TextField(
                          controller: _referralCodeController,
                          textCapitalization: TextCapitalization.characters,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(
                            labelText: 'كود ترشيح صديق (اختياري)',
                            prefixIcon: Icon(Icons.card_giftcard_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _technicianReferralCodeController,
                          textCapitalization: TextCapitalization.characters,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(
                            labelText: 'كود ترشيح فني (اختياري، من QR)',
                            prefixIcon: Icon(Icons.qr_code_2_outlined),
                          ),
                        ),
                      ],
                    ] else ...[
                      TextField(
                        key: const ValueKey('otp-field'),
                        controller: _otpController,
                        focusNode: _otpFocusNode,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.center,
                        maxLength: 6,
                        // ملء تلقائي من رسالة الـSMS على أندرويد/iOS — العميل ما بيخرجش من
                        // التطبيق أصلاً. مجاني بالكامل: سطر واحد والنظام بيتكفّل.
                        autofillHints: const [AutofillHints.oneTimeCode],
                        style: const TextStyle(
                          fontSize: 24,
                          letterSpacing: 8,
                          fontWeight: FontWeight.w700,
                        ),
                        // الإرسال بمجرد اكتمال الأرقام الستة — من غير ما يدوّر على الزرار.
                        onChanged: (value) {
                          if (value.length == 6 && !_isSubmitting) _verifyOtp();
                        },
                        onSubmitted: (_) => _isSubmitting ? null : _verifyOtp(),
                        decoration: const InputDecoration(
                          labelText: 'كود التحقق',
                          counterText: '',
                        ),
                      ),
                      TextButton.icon(
                        onPressed: _isSubmitting ? null : () => setState(() => _otpSent = false),
                        icon: const Icon(Icons.edit_outlined, size: 18),
                        label: const Text('رقم الموبايل غلط؟ رجّع خطوة'),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                    if (_suggestRegister) ...[
                      const SizedBox(height: 4),
                      TextButton(
                        onPressed: _isSubmitting ? null : _switchToRegister,
                        child: const Text('سجّل حساب جديد بنفس الرقم'),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _isSubmitting ? null : (_otpSent ? _verifyOtp : _requestOtp),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                      ),
                      child: _isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              _otpSent
                                  ? (_isRegisterMode ? 'إنشاء الحساب' : 'دخول')
                                  : 'ابعت كود التحقق',
                            ),
                    ),
                    if (!_otpSent) ...[
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _isSubmitting ? null : _toggleMode,
                        child: Text(
                          _isRegisterMode ? 'عندك حساب؟ سجّل دخول' : 'مستخدم جديد؟ اعمل حساب',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// هوية بصرية بسيطة أعلى شاشة الدخول (docs/08 §77-B2).
///
/// **طلب المالك**: «كسفة شاشة الدخول دي… خليها مزغروفة وجميلة». الشاشة كانت عمود نصوص وحقول
/// بلا أي هوية.
///
/// **ليه شكل مرسوم بالكود مش صورة/أنيميشن؟** أول شاشة في التطبيق لازم تفتح فورًا. صورة raster
/// أو Lottie معناها انتظار تحميل/فك ترميز في اللحظة اللي المستخدم فيها أقل صبرًا، وحزمة أكبر
/// بلا مقابل. الشكل ده بيترسم في نفس الإطار، بيتكيّف مع الثيم الفاتح/الغامق لوحده، وبصفر بايت
/// أصول.
class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Container(
          width: 92,
          height: 92,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.primary, Color(0xFF7FA6E0)],
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.28),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: const Icon(Icons.handyman_rounded, size: 44, color: Colors.white),
        ),
        const SizedBox(height: 14),
        Text(
          'صُنّاع',
          style: theme.textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'صنايعية متحقّق منهم، لحد باب بيتك',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
