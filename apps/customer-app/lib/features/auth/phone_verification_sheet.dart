import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';

/// **تأكيد رقم الموبايل قبل أول طلب** (ADR-0112).
///
/// بتفتح **من جوّه فلو الحجز** لما الباك-إند يرفض إنشاء الطلب بـ`AUTH_009`. الشرط ده مقفول
/// افتراضيًا، فالشاشة دي عمرها ما تظهر لحد ما الأدمن يفعّل الخاصية.
///
/// ### ليه bottom sheet مش شاشة كاملة
///
/// العميل ملوّ بيانات الحجز كلها (خدمة، عنوان، موعد، صور، كود خصم). الانتقال لشاشة تانية ورجوع
/// كان بيخلّي ضياع الحجز احتمال حقيقي مع أول زرار رجوع. الـsheet بتحفظ الشاشة ورا الخلفية،
/// وبترجّع `true` بس لما التأكيد ينجح فعلاً — والحجز بيكمل من نفس النقطة.
///
/// ### تصحيح الرقم جوّاها
///
/// الطلب الصريح من المالك: «لو هو كان مدخل رقم موبايل غلط بيكون عنده الإمكانية إنه يغيّر رقم
/// الموبايل». من غير ده، عميل كتب رقمه غلط وقت التسجيل كان بيبقى في طريق مسدود تام — الكود بيروح
/// لرقم مش بتاعه، وهو مش قادر يطلب. تغيير الرقم محتاج **رمز الدخول** كمان (ADR-0112 §5).
class PhoneVerificationSheet extends StatefulWidget {
  const PhoneVerificationSheet({super.key, required this.currentPhone});

  final String currentPhone;

  /// بترجّع `true` لو الرقم اتأكد فعلاً — المُنادي يكمّل الحجز ساعتها وبس.
  static Future<bool> show(BuildContext context, {required String currentPhone}) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      // مش `isDismissible: false` — العميل من حقه يقفلها ويرجع للحجز. اللي بيمنع الالتباس هو إن
      // الحجز مايكملش غير مع `true`.
      builder: (sheetContext) => Padding(
        // الكيبورد بيغطّي خانة الكود على الشاشات الصغيرة من غير الحشو ده.
        padding: EdgeInsets.only(bottom: MediaQuery.of(sheetContext).viewInsets.bottom),
        child: PhoneVerificationSheet(currentPhone: currentPhone),
      ),
    );
    return result ?? false;
  }

  @override
  State<PhoneVerificationSheet> createState() => _PhoneVerificationSheetState();
}

class _PhoneVerificationSheetState extends State<PhoneVerificationSheet> {
  final _codeController = TextEditingController();
  final _phoneController = TextEditingController();
  final _pinController = TextEditingController();
  bool _busy = false;
  bool _codeSent = false;
  bool _changingPhone = false;
  String? _error;
  String _targetPhone = '';

  @override
  void initState() {
    super.initState();
    _targetPhone = widget.currentPhone;
    _phoneController.text = widget.currentPhone;
  }

  @override
  void dispose() {
    _codeController.dispose();
    _phoneController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  AuthRepository get _auth => context.read<AuthRepository>();

  Future<void> _sendCode() async {
    final newPhone = _changingPhone ? _phoneController.text.trim() : null;
    if (_changingPhone && (newPhone == null || newPhone.length < 10)) {
      setState(() => _error = 'اكتب رقم موبايل صحيح');
      return;
    }
    if (_changingPhone && _pinController.text.trim().isEmpty) {
      setState(() => _error = 'لتغيير الرقم لازم تكتب رمز الدخول بتاعك');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final target = await _auth.requestPhoneVerification(
        newPhoneNumber: newPhone,
        pin: _changingPhone ? _pinController.text.trim() : null,
      );
      if (!mounted) return;
      setState(() {
        _codeSent = true;
        // **الرقم اللي السيرفر بعت له فعلاً** مش اللي التطبيق افترضه — لو السيرفر طبّع الرقم
        // بشكل مختلف، العميل لازم يشوف اللي هو بعت له عشان يعرف يدوّر على الرسالة فين.
        _targetPhone = target.isEmpty ? _targetPhone : target;
        _codeController.clear();
      });
    } catch (errRaw) {
      final err = ApiException.from(errRaw);
      if (mounted) setState(() => _error = err.displayMessage);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    if (_codeController.text.trim().length != 6) {
      setState(() => _error = 'الكود ٦ أرقام');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _auth.confirmPhoneVerification(
        otpCode: _codeController.text.trim(),
        newPhoneNumber: _changingPhone ? _phoneController.text.trim() : null,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (errRaw) {
      final err = ApiException.from(errRaw);
      // الخانة بتتفضّى: كود اترفض مش هينفع تاني، وسيبانه مكتوب أسرع طريقة يستهلك بيها محاولاته.
      _codeController.clear();
      if (mounted) setState(() => _error = err.displayMessage);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('أكّد رقم موبايلك', style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              _codeSent
                  ? 'بعتنا كود على $_targetPhone — اكتبه هنا.'
                  : 'قبل أول طلب بنتأكد إن رقمك واصل. هنبعتلك كود على $_targetPhone.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            if (_changingPhone) ...[
              TextField(
                key: const ValueKey('phone-verify-new-phone'),
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(labelText: 'رقم الموبايل الجديد'),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('phone-verify-pin'),
                controller: _pinController,
                obscureText: true,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: const InputDecoration(
                  labelText: 'رمز الدخول الحالي',
                  helperText: 'بنطلبه عشان محدش غيرك يغيّر رقم حسابك',
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (_codeSent) ...[
              TextField(
                key: const ValueKey('phone-verify-code'),
                controller: _codeController,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: const InputDecoration(labelText: 'كود التأكيد (٦ أرقام)'),
              ),
              const SizedBox(height: 8),
            ],
            if (_error != null) ...[
              Text(
                _error!,
                key: const ValueKey('phone-verify-error'),
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error),
              ),
              const SizedBox(height: 8),
            ],
            FilledButton(
              key: const ValueKey('phone-verify-submit'),
              onPressed: _busy ? null : (_codeSent ? _confirm : _sendCode),
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_codeSent ? 'أكّد الكود' : 'ابعت الكود'),
            ),
            if (_codeSent)
              TextButton(
                key: const ValueKey('phone-verify-resend'),
                onPressed: _busy ? null : _sendCode,
                child: const Text('ما جاليش كود — ابعت تاني'),
              ),
            TextButton(
              key: const ValueKey('phone-verify-toggle-change'),
              onPressed: _busy
                  ? null
                  : () => setState(() {
                        _changingPhone = !_changingPhone;
                        // الرجوع لتأكيد الرقم الحالي لازم يرجّع الخانة لقيمتها الأصلية، وإلا رقم
                        // نص مكتوب بيفضل ظاهر وبيلبّس.
                        if (!_changingPhone) _phoneController.text = widget.currentPhone;
                        _codeSent = false;
                        _error = null;
                      }),
              child: Text(_changingPhone ? 'أكّد رقمي الحالي بدل كده' : 'الرقم ده غلط؟ غيّره'),
            ),
          ],
        ),
      ),
    );
  }
}
