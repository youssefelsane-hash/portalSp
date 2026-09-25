import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';

/// **شاشة تعيين/تغيير رمز الدخول** (ADR-0109 §6-أ).
///
/// وضعان:
///  - `SetPinMode.migration` — فني **داخل بالفعل** من قبل التبديل ومالوش رمز. الشاشة
///    **مالهاش مخرج**: من غير رمز الحساب ده مالوش أي credential خالص، فأول ما الجلسة تنتهي
///    (تسجيل خروج، موبايل جديد، توكن ملغي) الفني يبقى مقفول برّه حسابه — وجوّه الحساب ده
///    أرباحه ورصيده. شاشة واحدة مرة واحدة أرخص من فني واقف مش قادر يشتغل.
///  - `SetPinMode.change` — تغيير طوعي من شاشة الحساب. بيطلب الرمز الحالي، وبيقدر يرجع.
///
/// **ليه مش شاشة الدخول نفسها؟** تعيين الرمز هنا بيحصل بتوكن صالح (`POST /auth/pin`) —
/// المستخدم متوثّق أصلاً فمفيش استيلاء ممكن. الخيار التاني («أي حد مالوش رمز يحط واحد من شاشة
/// الدخول») مرفوض صراحة في ADR-0109 §6-أ لأنه استيلاء على أي حساب لأي حد يعرف رقم تليفون.
enum SetPinMode { migration, change }

class SetPinScreen extends StatefulWidget {
  const SetPinScreen({super.key, this.mode = SetPinMode.change});

  final SetPinMode mode;

  @override
  State<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends State<SetPinScreen> {
  final _currentPinController = TextEditingController();
  final _pinController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  bool get _isMigration => widget.mode == SetPinMode.migration;

  @override
  void dispose() {
    _currentPinController.dispose();
    _pinController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  /// نفس قاعدة `isWeakPin` في `login-pin.policy.ts` بالحرف — الباك-إند بيفحص تاني، ده بس
  /// عشان المستخدم ياخد رد فوري بدل رحلة شبكة.
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
      await context.read<AuthRepository>().setPin(
        pin,
        currentPin: _isMigration ? null : _currentPinController.text.trim(),
      );
      if (!mounted) return;
      // في وضع الهجرة `_AuthGate` بيعيد البناء لوحده أول ما `pinSet` يبقى true — مفيش pop.
      if (!_isMigration) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('رمز الدخول اتغيّر')));
      }
    } catch (errRaw) {
      final err = ApiException.from(errRaw);
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
        // وضع الهجرة مالوش appBar عمدًا: مفيش زرار رجوع لأن مفيش مكان يرجع له.
        appBar: _isMigration
            ? null
            : AppBar(title: const Text('تغيير رمز الدخول')),
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
                    Icon(
                      Icons.lock_outline_rounded,
                      size: 56,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _isMigration ? 'اختار رمز دخول لحسابك' : 'رمز دخول جديد',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _isMigration
                          ? 'بقيت تدخل بالرمز ده بدل كود الرسايل — أسرع وما بيحتاجش انتظار. '
                                'خزّنه في مكان تفتكره: هو اللي هيرجّعك لحسابك وأرباحك لو سجّلت '
                                'خروج أو غيّرت موبايلك.'
                          : 'اكتب رمزك الحالي والرمز الجديد.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (!_isMigration) ...[
                      _PinField(
                        fieldKey: const ValueKey('set-pin-current-field'),
                        controller: _currentPinController,
                        label: 'الرمز الحالي',
                      ),
                      const SizedBox(height: 12),
                    ],
                    _PinField(
                      fieldKey: const ValueKey('set-pin-field'),
                      controller: _pinController,
                      label: 'رمز الدخول (6 أرقام)',
                      autofocus: _isMigration,
                    ),
                    const SizedBox(height: 12),
                    _PinField(
                      fieldKey: const ValueKey('set-pin-confirm-field'),
                      controller: _confirmController,
                      label: 'أكّد الرمز',
                      onSubmitted: _isSubmitting ? null : _submit,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      key: const ValueKey('set-pin-submit'),
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
                          : Text(_isMigration ? 'تأكيد الرمز' : 'حفظ'),
                    ),
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

class _PinField extends StatelessWidget {
  const _PinField({
    required this.fieldKey,
    required this.controller,
    required this.label,
    this.autofocus = false,
    this.onSubmitted,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final VoidCallback? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
      maxLength: 6,
      obscureText: true,
      style: const TextStyle(
        fontSize: 24,
        letterSpacing: 8,
        fontWeight: FontWeight.w700,
      ),
      onSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
      decoration: InputDecoration(labelText: label, counterText: ''),
    );
  }
}
