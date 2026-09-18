import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../orders/qr_code_scan_screen.dart';
import 'technician_referral_repository.dart';

// كود ترشيح فني (docs/11 §1) — لعميل مسجّل بالفعل.
//
// المسح بالكاميرا بقى موجود (docs/08 §165، طلب مالك 2026-09-18: «يبقى متاح دايمًا مكان يدوس
// عليه يفتح بيه الكاميرا يسكن بدل ما يقعد يكتب الكود بإيده»). الماسح نفسه مش جديد —
// `QrCodeScanScreen` موجودة لأكواد الخصم، واستخراج الكود بقى بيفهم روابط `/t/` كمان.
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

  /// بيفتح نفس ماسح أكواد الخصم — شاشة واحدة لكل مسح في التطبيق، مفيش نسخة تانية.
  Future<void> _scan() async {
    final scanned = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const QrCodeScanScreen()),
    );
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    setState(() {
      _codeController.text = scanned.trim();
      _error = null;
    });
    // المسح نية واضحة إن ده الكود المقصود، فبنكمّل على طول بدل ما نطلب دوسة تانية.
    await _submit();
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
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
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
                    const Text('لو فني رشّحلك، امسح الـQR بتاعه أو اكتب كوده هنا:'),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _submitting ? null : _scan,
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('امسح الكود بالكاميرا'),
                    ),
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
