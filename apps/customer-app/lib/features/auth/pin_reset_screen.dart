import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';

/// **استرجاع رمز الدخول** (ADR-0109 §6-ب).
///
/// الشاشة دي هي **المخرج الوحيد** لمستخدم نسي رمزه وهو مش داخل. مفيش SMS بعد التبديل، فالمسار:
/// المستخدم بيكلّم الدعم ← الدعم بيتأكد من هويته ويصدر كود ← بيقوله الكود في المكالمة ←
/// المستخدم بيكتبه هنا **ويختار رمزه بنفسه**.
///
/// **ليه الأدمن مش بيحط الرمز؟** (ADR-0109 §6-ب) لو الأدمن اختاره، يبقى فيه بني آدم تاني يعرف
/// سر دخول المستخدم ولازم يتقال في مكالمة — تسريب بالتصميم، والأسوأ إن أغلب الناس مابتغيّرش
/// الرمز المؤقت بعد كده.
class PinResetScreen extends StatefulWidget {
  const PinResetScreen({super.key, this.initialPhone});

  final String? initialPhone;

  @override
  State<PinResetScreen> createState() => _PinResetScreenState();
}

class _PinResetScreenState extends State<PinResetScreen> {
  late final TextEditingController _phoneController = TextEditingController(
    text: widget.initialPhone ?? '+20',
  );
  final _codeController = TextEditingController();
  final _pinController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    _codeController.dispose();
    _pinController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  /// نفس قاعدة `isWeakPin` في `login-pin.policy.ts` بالحرف.
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

  Future<void> _submit() async {
    final pin = _pinController.text.trim();
    if (_codeController.text.trim().length != 10) {
      setState(() => _error = 'كود الاسترجاع 10 أرقام');
      return;
    }
    if (pin.length != 6) {
      setState(() => _error = 'رمز الدخول لازم يكون 6 أرقام');
      return;
    }
    if (_isWeakPin(pin)) {
      setState(
        () => _error =
            'الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم',
      );
      return;
    }
    if (_confirmController.text.trim() != pin) {
      setState(() => _error = 'الرمزين مش زي بعض — اكتب نفس الرمز في الخانتين');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await context.read<AuthRepository>().redeemPinResetCode(
        _phoneController.text.trim(),
        _codeController.text.trim(),
        pin,
      );
      if (!mounted) return;
      // مفيش جلسة بترجع — المستخدم بيدخل بالرمز الجديد من شاشة الدخول العادية.
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الرمز اتحفظ — ادخل بيه دلوقتي')),
      );
    } catch (errRaw) {
      final err = ApiException.from(errRaw);
      // الكود بيتفضّى: كود اترفض مش هينفع تاني، وسيبانه بيحرق محاولة من الخمسة.
      _codeController.clear();
      setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('استرجاع رمز الدخول')),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'كلّم خدمة العملاء، وهيدّوك كود استرجاع في المكالمة. اكتبه هنا واختار رمز دخول جديد.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    key: const ValueKey('pin-reset-phone-field'),
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                      LengthLimitingTextInputFormatter(16),
                    ],
                    autofocus: widget.initialPhone == null,
                    textInputAction: TextInputAction.next,
                    onSubmitted: (_) => FocusScope.of(context).nextFocus(),
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                      labelText: 'رقم الموبايل',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    key: const ValueKey('pin-reset-code-field'),
                    controller: _codeController,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.center,
                    maxLength: 10,
                    autofocus: widget.initialPhone != null,
                    textInputAction: TextInputAction.next,
                    onSubmitted: (_) => FocusScope.of(context).nextFocus(),
                    decoration: const InputDecoration(
                      labelText: 'كود الاسترجاع (10 أرقام)',
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 12),
                  _PinBox(
                    fieldKey: const ValueKey('pin-reset-new-field'),
                    controller: _pinController,
                    label: 'رمز الدخول الجديد (6 أرقام)',
                    onSubmitted: () => FocusScope.of(context).nextFocus(),
                  ),
                  const SizedBox(height: 12),
                  _PinBox(
                    fieldKey: const ValueKey('pin-reset-confirm-field'),
                    controller: _confirmController,
                    label: 'أكّد الرمز',
                    textInputAction: TextInputAction.done,
                    onSubmitted: _isSubmitting ? null : _submit,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _error!,
                      key: const ValueKey('pin-reset-error-text'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    key: const ValueKey('pin-reset-submit'),
                    onPressed: _isSubmitting ? null : _submit,
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
                        : const Text('احفظ الرمز الجديد'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PinBox extends StatelessWidget {
  const _PinBox({
    required this.fieldKey,
    required this.controller,
    required this.label,
    this.textInputAction = TextInputAction.next,
    this.onSubmitted,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final TextInputAction textInputAction;
  final VoidCallback? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
      maxLength: 6,
      obscureText: true,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
      style: const TextStyle(
        fontSize: 24,
        letterSpacing: 8,
        fontWeight: FontWeight.w700,
      ),
      decoration: InputDecoration(labelText: label, counterText: ''),
    );
  }
}
