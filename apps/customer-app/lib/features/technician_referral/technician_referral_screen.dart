import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'technician_referral_repository.dart';

// كود ترشيح فني (docs/11 §1) — لعميل مسجّل بالفعل. مسح QR بالكاميرا مؤجّل عمدًا (نفس قرار
// مسح QR العمائر — مفيش جهاز حقيقي للاختبار)، إدخال يدوي بس حاليًا.
class TechnicianReferralScreen extends StatefulWidget {
  const TechnicianReferralScreen({super.key});

  @override
  State<TechnicianReferralScreen> createState() => _TechnicianReferralScreenState();
}

class _TechnicianReferralScreenState extends State<TechnicianReferralScreen> {
  final _codeController = TextEditingController();
  bool _submitting = false;
  String? _error;
  bool _success = false;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final repository = TechnicianReferralRepository(context.read<AuthRepository>());
      await repository.attribute(code);
      if (mounted) setState(() => _success = true);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('كود ترشيح فني')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: _success
              ? const Center(child: Text('تمام! هيكسب الفني ده مكافأة أول ما تحجز خدمة معانا. 🎉'))
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('لو فني رشّحلك وأديك كوده، اكتبه هنا:'),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _codeController,
                      textCapitalization: TextCapitalization.characters,
                      textDirection: TextDirection.ltr,
                      decoration: const InputDecoration(labelText: 'كود الفني', hintText: 'TECH-000001'),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: Text(_submitting ? 'جاري الحفظ…' : 'حفظ الكود'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
