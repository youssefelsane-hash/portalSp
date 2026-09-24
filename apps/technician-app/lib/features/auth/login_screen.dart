import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/adaptive_text_action.dart';

/// شاشة دخول/تسجيل الفني — **رقم موبايل + رمز دخول** (ADR-0109).
///
/// قبل كده كانت: رقم ← «ابعت كود التحقق» ← نداء شبكة يبعت SMS ← انتظار الرسالة ← كتابة الكود.
/// دلوقتي: رقم + رمز ← دخول. **الخطوة الأولى بلا أي نداء شبكة خالص** — التحقق محلي والانتقال
/// فوري، وده أكبر فرق بيحسّه الفني في التغيير كله (كان بيستنى SMS واقف في بيت عميل).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController(text: '+20');
  final _pinController = TextEditingController();
  // تأكيد الرمز وقت **التسجيل بس**: غلطة كتابة هنا معناها الفني مقفول برّه حسابه ومحتاج
  // استرجاع من الأدمن — تكلفة عالية جدًا لخانة واحدة زيادة.
  final _pinConfirmController = TextEditingController();
  final _fullNameController = TextEditingController();
  final _pinFocusNode = FocusNode();

  bool _pinStep = false;
  bool _isSubmitting = false;
  String? _error;
  bool _isRegisterMode = false;

  /// **اقتراح التسجيل بعد فشل دخول** — بيتعرض على **كل** فشل دخول بلا استثناء.
  ///
  /// قبل ADR-0109 كان مربوط بـ`statusCode == 404` («الرقم ده مش مسجل»). الرد الجديد
  /// **مايفرّقش** بين رقم مش مسجّل ورمز غلط (نفس الرسالة بالحرف — منع تعداد الحسابات،
  /// ADR-0109 §5)، فربط الاقتراح بالسبب بقى مستحيل. عرضه دايمًا مايسرّبش حاجة لأنه مستقل
  /// تمامًا عن وجود الحساب، وبيمنع الفني الجديد من إنه يتحاصر في شاشة رمز مالوش رمز فيها.
  bool _suggestRegister = false;

  @override
  void dispose() {
    _pinFocusNode.dispose();
    _phoneController.dispose();
    _pinController.dispose();
    _pinConfirmController.dispose();
    _fullNameController.dispose();
    super.dispose();
  }

  /// **الانتقال لخطوة الرمز — بلا أي نداء شبكة** (ADR-0109).
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

  /// نفس قاعدة `isWeakPin` في `login-pin.policy.ts` بالحرف — الباك-إند بيفحص تاني، ده بس
  /// عشان الفني ياخد رد فوري بدل رحلة شبكة.
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

  Future<void> _submitPin() async {
    final pin = _pinController.text.trim();
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
        );
      } else {
        await auth.loginWithPin(_phoneController.text.trim(), pin);
      }
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة — مايتسابش يهرب فيسيب الشاشة
      // معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      // الخانة بتتفضّى: الرمز اللي اترفض مش هينفع تاني، وسيبانه مكتوب أسرع طريقة يستهلك بيها
      // الفني محاولاته الخمسة بلا فايدة.
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
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'أسطى',
                      style: Theme.of(context).textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _pinStep
                          ? (_isRegisterMode
                                ? 'اختار رمز دخول لحسابك'
                                : 'اكتب رمز الدخول بتاعك')
                          : (_isRegisterMode
                                ? 'اعمل حساب فني جديد'
                                : 'ادخل رقم موبايلك ورمز دخولك'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium,
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
                        onSubmitted: (_) => _isSubmitting ? null : _goToPinStep(),
                        decoration: const InputDecoration(
                          labelText: 'رقم الموبايل',
                          hintText: '+201001234567',
                        ),
                      ),
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
                        // **مخفي**: رمز دائم مش كود بيموت بعد دقايق — والفني بيدخل وهو واقف
                        // في بيت عميل، فحد جنبه ممكن يقراه.
                        obscureText: true,
                        style: const TextStyle(
                          fontSize: 24,
                          letterSpacing: 8,
                          fontWeight: FontWeight.w700,
                        ),
                        // مفيش إرسال تلقائي عند ٦ أرقام: الرمز ممكن يكون ٤ أو ٥ أو ٦، فالإرسال
                        // التلقائي كان هيبعت رمز ناقص ويحرق محاولة.
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
                      AdaptiveTextAction(
                        key: const ValueKey('login-back-to-phone'),
                        onPressed: _isSubmitting ? null : _backToPhoneStep,
                        icon: Icons.edit_outlined,
                        label: 'رقم موبايل غلط؟ رجّع خطوة',
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        key: const ValueKey('login-error-text'),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ],
                    if (_suggestRegister) ...[
                      const SizedBox(height: 4),
                      AdaptiveTextAction(
                        key: const ValueKey('login-suggest-register'),
                        onPressed: _isSubmitting ? null : _switchToRegister,
                        label: 'معندكش حساب؟ سجّل حساب فني بنفس الرقم',
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
                      const SizedBox(height: 12),
                      AdaptiveTextAction(
                        key: const ValueKey('login-toggle-mode'),
                        onPressed: _isSubmitting ? null : _toggleMode,
                        label: _isRegisterMode
                            ? 'عندك حساب؟ سجّل دخول'
                            : 'فني جديد؟ سجّل حساب',
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
