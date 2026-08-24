import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../installments/installments_repository.dart';

/// قسم "ادفع بالتقسيط" على شاشة تفاصيل الطلب — بيظهر بس لو الخدمة عليها خطط متاحة.
///
/// التدفق: العميل يختار خطة → يراجع الشروط → يقدم الطلب → الحالة تبقى "تحت المراجعة"
/// والأدمن هو اللي بيعتمد أو يرفض (مفيش موافقة ذاتية).
class InstallmentSection extends StatefulWidget {
  final AuthRepository auth;
  final String orderId;
  final String serviceId;

  const InstallmentSection({
    super.key,
    required this.auth,
    required this.orderId,
    required this.serviceId,
  });

  @override
  State<InstallmentSection> createState() => _InstallmentSectionState();
}

class _InstallmentSectionState extends State<InstallmentSection> {
  List<InstallmentPlan>? _plans;
  InstallmentPlan? _selectedPlan;
  bool _accepted = false;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final repo = InstallmentRepository(widget.auth);
      final plans = await repo.fetchPlans(widget.serviceId);
      if (mounted) setState(() => _plans = plans);
    } on ApiException {
      if (mounted) setState(() => _plans = []);
    }
  }

  Future<void> _submit() async {
    if (_selectedPlan == null || !_accepted) return;
    setState(() { _submitting = true; _error = null; });
    try {
      final repo = InstallmentRepository(widget.auth);
      await repo.submitApplication(
        orderId: widget.orderId,
        planId: _selectedPlan!.id,
        acceptedPolicyVersionIds: [], // الباك-إند بيتحقق من السياسات المطلوبة
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تقديم طلب التقسيط — تحت المراجعة')),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final plans = _plans;
    if (plans == null || plans.isEmpty) return const SizedBox.shrink();

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('ادفع بالتقسيط', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...plans.map((plan) => RadioListTile<String>(
                  value: plan.id,
                  groupValue: _selectedPlan?.id,
                  onChanged: (v) => setState(() {
                    _selectedPlan = plans.firstWhere((p) => p.id == v);
                  }),
                  title: Text(plan.nameAr),
                  subtitle: Text(
                    '${plan.installmentCount} أقساط كل ${plan.intervalDays} يوم'
                    '${plan.financingPercentage > 0 ? ' · تمويل ${plan.financingPercentage.toStringAsFixed(0)}%' : ''}'
                    '${plan.downPaymentPercentage > 0 ? ' · مقدم ${plan.downPaymentPercentage.toStringAsFixed(0)}%' : ''}',
                  ),
                )),
            if (_selectedPlan != null) ...[
              const SizedBox(height: 8),
              CheckboxListTile(
                value: _accepted,
                onChanged: (v) => setState(() => _accepted = v ?? false),
                title: const Text('أوافق على شروط التقسيط', style: TextStyle(fontSize: 14)),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: FilledButton(
                  onPressed: _submitting || !_accepted ? null : _submit,
                  child: _submitting
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('قدّم طلب التقسيط'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
