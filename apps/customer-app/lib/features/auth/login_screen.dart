import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_config.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'pin_reset_screen.dart';
import '../../design/app_theme.dart';
import '../../design/adaptive_text_action.dart';
import '../catalog/branding_repository.dart';

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
  // ADR-0109 — الخانة بقت رمز دخول بدل كود SMS. الاسم اتغيّر عشان مايفضلش يكدب.
  final _pinController = TextEditingController();
  // تأكيد الرمز وقت **التسجيل بس**: غلطة كتابة هنا معناها المستخدم مقفول برّه حسابه ومحتاج
  // استرجاع من الأدمن — تكلفة عالية جدًا لخانة واحدة زيادة.
  final _pinConfirmController = TextEditingController();
  final _fullNameController = TextEditingController();
  final _referralCodeController = TextEditingController();
  final _technicianReferralCodeController = TextEditingController();

  /// **طلب مالك صريح (docs/08 §77-B2)**: «أول ما يدوس التالي عايز أوتوماتيك الكيبورد يطلع…
  /// ويبقى البوينتر محطوط أوتوماتيك جوه الخانة». `autofocus` لوحده ما ينفعش هنا لأن الحقل
  /// بيتبنى في نفس الإطار اللي `_pinStep` بيتغيّر فيه — الحل `FocusNode` بيتطلب التركيز بعد
  /// ما الإطار يخلص.
  final _pinFocusNode = FocusNode();

  /// وصلنا لخطوة الرمز؟ (كانت `_pinStep` — دلوقتي مفيش إرسال أصلاً، الانتقال محلي بالكامل
  /// وبلا أي نداء شبكة، وده أسرع خطوة دخول في التطبيق كله.)
  bool _pinStep = false;
  bool _isSubmitting = false;
  String? _error;
  // تسجيل عميل جديد — نفس الشاشة، مود مختلف بس. الفرق: خطوة إضافية للاسم الكامل، وتأكيد
  // الرمز، ونداء `registerWithPin()` بدل `loginWithPin()`.
  bool _isRegisterMode = false;

  /// **اقتراح التسجيل بعد فشل دخول** — بيتعرض على **كل** فشل دخول بلا استثناء.
  ///
  /// قبل ADR-0109 كان بيتعرض بس لما الباك-إند يقول «الرقم مش مسجّل». الرد الجديد **مايفرّقش**
  /// بين رقم مش مسجّل ورمز غلط (نفس الرسالة بالحرف — منع تعداد الحسابات، ADR-0109 §5)، فربط
  /// الاقتراح بالسبب بقى مستحيل. عرضه دايمًا **مايسرّبش حاجة** لأنه مستقل تمامًا عن وجود
  /// الحساب، وفي نفس الوقت بيمنع المستخدم الجديد من إنه يتحاصر في شاشة رمز مالوش رمز فيها.
  bool _suggestRegister = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _pinController.dispose();
    _pinConfirmController.dispose();
    _fullNameController.dispose();
    _referralCodeController.dispose();
    _technicianReferralCodeController.dispose();
    _pinFocusNode.dispose();
    super.dispose();
  }

  /// **الانتقال لخطوة الرمز — بلا أي نداء شبكة** (ADR-0109).
  ///
  /// كانت `_requestOtp()` بتنادي السيرفر عشان يبعت SMS ويستنى الرد. دلوقتي مفيش حاجة تتبعت
  /// خالص: التحقق محلي والانتقال فوري. ده أكبر فرق بيحسّه المستخدم في التغيير كله.
  void _goToPinStep() {
    final phone = _phoneController.text.trim();
    if (phone.replaceAll(RegExp(r'[^0-9]'), '').length < 10) {
      setState(() => _error = 'اكتب رقم موبايل صحيح');
      return;
    }
    if (_isRegisterMode && _fullNameController.text.trim().length < 2) {
      setState(() => _error = 'اكتب اسمك الكامل الأول');
      return;
    }
    setState(() {
      _pinStep = true;
      _error = null;
      _suggestRegister = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _pinFocusNode.requestFocus();
    });
  }

  Future<void> _submitPin() async {
    final pin = _pinController.text.trim();
    // فحص محلي قبل أي نداء — نفس قواعد `login-pin.policy.ts` في الباك-إند. الباك-إند هو
    // مصدر الحقيقة وبيفحص تاني؛ ده بس عشان المستخدم ياخد رد فوري بدل رحلة شبكة.
    if (pin.length < 4) {
      setState(() => _error = 'رمز الدخول لازم يكون من 4 لـ6 أرقام');
      return;
    }
    if (_isRegisterMode) {
      if (_isWeakPin(pin)) {
        setState(() => _error = 'الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم');
        return;
      }
      if (_pinConfirmController.text.trim() != pin) {
        setState(() => _error = 'الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
        return;
      }
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
      _suggestRegister = false;
    });
    try {
      final auth = context.read<AuthRepository>();
      if (_isRegisterMode) {
        await auth.registerWithPin(
          _phoneController.text.trim(),
          pin,
          _fullNameController.text.trim(),
          referralCode: _referralCodeController.text.trim(),
          technicianReferralCode: _technicianReferralCodeController.text.trim(),
        );
      } else {
        await auth.loginWithPin(_phoneController.text.trim(), pin);
      }
      if (widget.isModal && mounted) Navigator.of(context).pop(true);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة — مايتسابش يهرب فيسيب
      // الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      // الخانة بتتفضّى: الرمز اللي اترفض مش هينفع تاني، وسيبانه مكتوب بيخلي المستخدم يضغط
      // «دخول» على نفس الرمز الغلط ويحرق محاولة من الخمسة بلا داعي.
      _pinController.clear();
      setState(() {
        _error = err.message;
        _suggestRegister = !_isRegisterMode;
      });
      _pinFocusNode.requestFocus();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// نفس قاعدة `isWeakPin` في الباك-إند بالحرف — كله نفس الرقم، أو تسلسل صاعد/نازل.
  static bool _isWeakPin(String pin) {
    if (pin.split('').toSet().length == 1) return true;
    final d = pin.split('').map(int.parse).toList();
    var asc = true, desc = true;
    for (var i = 1; i < d.length; i++) {
      if (d[i] != d[i - 1] + 1) asc = false;
      if (d[i] != d[i - 1] - 1) desc = false;
    }
    return asc || desc;
  }

  /// الرجوع لخطوة الرقم. الرمز بيتفضّى: رمز مكتوب لرقم اتغيّر هو أسوأ حالة ممكنة — محاولة
  /// محروقة على حساب حد تاني.
  void _backToPhoneStep() {
    setState(() {
      _pinStep = false;
      _pinController.clear();
      _pinConfirmController.clear();
      _error = null;
    });
  }

  void _switchToRegister() {
    setState(() {
      _isRegisterMode = true;
      _pinStep = false;
      _pinController.clear();
      _pinConfirmController.clear();
      _error = null;
      _suggestRegister = false;
    });
  }

  void _toggleMode() {
    setState(() {
      _isRegisterMode = !_isRegisterMode;
      _pinStep = false;
      _pinController.clear();
      _pinConfirmController.clear();
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
        appBar: widget.isModal
            ? AppBar(title: const Text('تسجيل الدخول'))
            : null,
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
                          (_isRegisterMode
                              ? 'اعمل حساب جديد'
                              : 'أهلًا بيك في أسطى'),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _pinStep
                          ? (_isRegisterMode
                              ? 'اختار رمز دخول لحسابك — هتستخدمه لو سجّلت من جديد'
                              : 'اكتب رمز الدخول بتاعك')
                          : (_isRegisterMode
                              ? 'اكتب بياناتك وهتختار رمز دخول في الخطوة الجاية'
                              : 'اكتب رقم موبايلك ورمز دخولك'),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (!_pinStep) ...[
                      if (_isRegisterMode) ...[
                        TextField(
                          key: const ValueKey('login-full-name-field'),
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
                        key: const ValueKey('login-phone-field'),
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        textDirection: TextDirection.ltr,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) =>
                            _isSubmitting ? null : _goToPinStep(),
                        decoration: const InputDecoration(
                          labelText: 'رقم الموبايل',
                          hintText: '+201001234567',
                          prefixIcon: Icon(Icons.phone_iphone_rounded),
                        ),
                      ),
                      if (_isRegisterMode) ...[
                        const SizedBox(height: 12),
                        TextField(
                          key: const ValueKey('login-referral-field'),
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
                          key: const ValueKey('login-technician-referral-field'),
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
                        key: const ValueKey('login-pin-field'),
                        controller: _pinController,
                        focusNode: _pinFocusNode,
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.center,
                        maxLength: 6,
                        // **مخفي**: رمز دائم مش كود بيموت بعد دقايق — حد واقف جنبك مايقراهوش.
                        obscureText: true,
                        // مفيش `autofillHints.oneTimeCode` — ده مش كود من SMS، والنظام
                        // مايعرضش اقتراحات غلط على خانة رمز دائم.
                        style: const TextStyle(
                          fontSize: 24,
                          letterSpacing: 8,
                          fontWeight: FontWeight.w700,
                        ),
                        // مفيش إرسال تلقائي عند ٦ أرقام: الرمز ممكن يكون ٤ أو ٥ أو ٦، فالإرسال
                        // التلقائي كان هيبعت رمز ناقص ويحرق محاولة. المستخدم بيضغط بنفسه.
                        onSubmitted: (_) => _isSubmitting ? null : _submitPin(),
                        decoration: InputDecoration(
                          labelText: _isRegisterMode ? 'اختار رمز دخول (4–6 أرقام)' : 'رمز الدخول',
                          counterText: '',
                        ),
                      ),
                      if (_isRegisterMode) ...[
                        const SizedBox(height: 12),
                        TextField(
                          key: const ValueKey('login-pin-confirm-field'),
                          controller: _pinConfirmController,
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          textDirection: TextDirection.ltr,
                          textAlign: TextAlign.center,
                          maxLength: 6,
                          obscureText: true,
                          style: const TextStyle(fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w700),
                          onSubmitted: (_) => _isSubmitting ? null : _submitPin(),
                          decoration: const InputDecoration(labelText: 'أكّد الرمز', counterText: ''),
                        ),
                      ],
                      // **المخرج الوحيد لمستخدم نسي رمزه** (ADR-0109 §6-ب) — مفيش SMS بعد
                      // التبديل، فالاسترجاع بيمرّ على الدعم. لازم يبقى ظاهر هنا بالذات: ده
                      // المكان اللي المستخدم بيكتشف فيه إنه نسي.
                      AdaptiveTextAction(
                        key: const ValueKey('login-forgot-pin'),
                        onPressed: _isSubmitting
                            ? null
                            : () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => PinResetScreen(
                                      initialPhone: _phoneController.text.trim(),
                                    ),
                                  ),
                                ),
                        icon: Icons.help_outline_rounded,
                        label: 'نسيت رمز الدخول؟',
                      ),
                      AdaptiveTextAction(
                        key: const ValueKey('login-back-to-phone'),
                        onPressed: _isSubmitting ? null : _backToPhoneStep,
                        icon: Icons.edit_outlined,
                        label: 'رقم الموبايل غلط؟ رجّع خطوة',
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        key: const ValueKey('login-error-text'),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                    if (_suggestRegister) ...[
                      const SizedBox(height: 4),
                      AdaptiveTextAction(
                        key: const ValueKey('login-suggest-register'),
                        onPressed: _isSubmitting ? null : _switchToRegister,
                        label: 'معندكش حساب؟ سجّل بنفس الرقم',
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      key: const ValueKey('login-submit'),
                      onPressed: _isSubmitting
                          ? null
                          : (_pinStep ? _submitPin : _goToPinStep),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                      ),
                      child: _isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              _pinStep
                                  ? (_isRegisterMode ? 'إنشاء الحساب' : 'دخول')
                                  // مفيش كود بيتبعت خلاص — الزرار بيوصف الخطوة الجاية بس.
                                  : 'التالي',
                            ),
                    ),
                    if (!_pinStep) ...[
                      const SizedBox(height: 8),
                      AdaptiveTextAction(
                        key: const ValueKey('login-toggle-mode'),
                        onPressed: _isSubmitting ? null : _toggleMode,
                        label: _isRegisterMode
                            ? 'عندك حساب؟ سجّل دخول'
                            : 'مستخدم جديد؟ اعمل حساب',
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
/// علامة العلامة التجارية فوق شاشة الدخول.
///
/// **بيعرض `primary_logo` المرفوع من الأدمن لو موجود (docs/08 §78-ج)** — قبل كده كان في
/// `asset_type` منفصل اسمه `login_logo` مالوش **أي** مستهلك في أي تطبيق: خانة رفع في لوحة
/// الأدمن بترفع ملف حقيقي وما يظهرش في أي مكان. اتشال في migration 0210، والشاشة دي بقت
/// تستهلك اللوجو الأساسي — لوجو واحد للمنصة كلها بدل خانتين لازم الأدمن يزامنهم بإيده.
///
/// الدايرة المتدرّجة المرسومة بالكود بتفضل الاحتياطي: قبل ما الطلب يرجع، ولو الأدمن ما رفعش
/// حاجة (`is_default`)، ولو تحميل الصورة فشل. الشاشة أبدًا ما بتفضل بلا هوية.
class _BrandMark extends StatefulWidget {
  const _BrandMark();

  @override
  State<_BrandMark> createState() => _BrandMarkState();
}

class _BrandMarkState extends State<_BrandMark> {
  String? _logoUrl;

  @override
  void initState() {
    super.initState();
    BrandingRepository()
        .fetchPrimaryLogo()
        .then((logo) {
          if (!mounted || logo == null || logo.isDefault || logo.url.isEmpty) {
            return;
          }
          setState(() => _logoUrl = resolveApiAssetUrl(logo.url));
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final logoUrl = _logoUrl;
    return Column(
      children: [
        // ارتفاع ثابت + تلاشي: قبل كده اللوجو كان بيحل محل الدايرة البديلة **بقفزة**،
        // فالمستخدم يشوف شكلين مختلفين في نص ثانية ويحس إن فيه حاجة غلط (بلاغ 2026-09-10).
        SizedBox(
          height: 92,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child: logoUrl != null
                ? Image.network(
                    logoUrl,
                    key: ValueKey(logoUrl),
                    height: 92,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    errorBuilder: (_, _, _) => const _GradientBrandCircle(),
                  )
                : const _GradientBrandCircle(),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          'أسطى',
          style: theme.textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'متخصصين متحقّق منهم، لحد باب بيتك',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// الاحتياطي المرسوم بالكود — صفر أصول مطلوبة، فبيشتغل حتى لو الباك-إند مش شغّال خالص.
class _GradientBrandCircle extends StatelessWidget {
  const _GradientBrandCircle();

  @override
  Widget build(BuildContext context) {
    return Container(
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
    );
  }
}
