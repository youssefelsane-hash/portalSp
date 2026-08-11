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
  bool _otpSent = false;
  bool _isSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      await context.read<AuthRepository>().requestOtp(_phoneController.text.trim());
      setState(() => _otpSent = true);
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
    });
    try {
      await context.read<AuthRepository>().verifyOtp(_phoneController.text.trim(), _otpController.text.trim());
    } on ApiException catch (err) {
      setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('صُنّاع', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    _otpSent ? 'اتبعت كود لـ ${_phoneController.text}' : 'ادخل رقم موبايلك عشان تكمل',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 24),
                  if (!_otpSent) ...[
                    TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      textDirection: TextDirection.ltr,
                      decoration: const InputDecoration(labelText: 'رقم الموبايل', hintText: '+201001234567'),
                    ),
                  ] else ...[
                    TextField(
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      textDirection: TextDirection.ltr,
                      maxLength: 6,
                      decoration: const InputDecoration(labelText: 'كود التحقق (6 أرقام)'),
                    ),
                    TextButton(
                      onPressed: _isSubmitting ? null : () => setState(() => _otpSent = false),
                      child: const Text('رقم موبايل غلط؟ رجّع خطوة'),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _isSubmitting ? null : (_otpSent ? _verifyOtp : _requestOtp),
                    child: Text(_isSubmitting ? 'جاري التحميل…' : (_otpSent ? 'دخول' : 'ابعت كود التحقق')),
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
