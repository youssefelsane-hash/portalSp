import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';

/// شاشة "افتح ببصمتك" (docs/08 §17.22) — بتظهر بس لما فيه جلسة محفوظة (refresh_token) والبصمة
/// مفعّلة على الجهاز ده. مفيش أي بيانات بيومترية بتتعامل هنا مباشرة — الزرار بينادي
/// `AuthRepository.unlockWithBiometrics()` اللي بتفوّض التحقق الفعلي بالكامل لنظام التشغيل.
class BiometricUnlockScreen extends StatefulWidget {
  const BiometricUnlockScreen({super.key});

  @override
  State<BiometricUnlockScreen> createState() => _BiometricUnlockScreenState();
}

class _BiometricUnlockScreenState extends State<BiometricUnlockScreen> {
  bool _isAuthenticating = false;
  String? _error;

  Future<void> _unlock() async {
    setState(() {
      _isAuthenticating = true;
      _error = null;
    });
    final auth = context.read<AuthRepository>();
    final success = await auth.unlockWithBiometrics();
    if (!mounted) return;
    setState(() {
      _isAuthenticating = false;
      if (!success) {
        _error = 'محتاج تأكيد هويتك تاني — جرّب تاني أو استخدم رقم موبايلك';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.fingerprint, size: 96),
              const SizedBox(height: 24),
              const Text('افتح صُنّاع ببصمتك', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('عشان نحافظ على أمان حسابك حتى لو حد تاني ماسك موبايلك', textAlign: TextAlign.center),
              const SizedBox(height: 32),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
                const SizedBox(height: 16),
              ],
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isAuthenticating ? null : _unlock,
                  icon: _isAuthenticating
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.fingerprint),
                  label: Text(_isAuthenticating ? 'بنتحقق...' : 'افتح ببصمتك'),
                ),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _isAuthenticating ? null : () => context.read<AuthRepository>().useOtpInsteadOfBiometrics(),
                child: const Text('استخدم رقم موبايلك بدلاً'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
