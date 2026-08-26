import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../installments/installments_repository.dart';
import '../payment_methods/models.dart';
import '../payment_methods/payment_methods_repository.dart';

/// قسم "ادفع بالتقسيط" على شاشة تفاصيل الطلب.
///
/// التدفق: العميل يختار خطة → يراجع الشروط → يقدم الطلب → الحالة تبقى "تحت المراجعة"
/// والأدمن هو اللي بيعتمد أو يرفض (مفيش موافقة ذاتية).
///
/// docs/08 §64.ز — بلاغ المالك إن البانر كان «معلق فوق… على الرغم إنك لو اخترت أي خطة بيقولك
/// التقسيط مش متاح». السبب إن القسم كان بيسأل عن خطط **الخدمة** (`fetchPlans(serviceId)`) في
/// حين إن الأهلية الحقيقية بتعتمد على **الطلب** (مبلغه، حالته، تقديماته السابقة). دلوقتي بيسأل
/// `/orders/:id/installment-options` اللي بيطبّق نفس قيود التقديم قبل العرض:
///  - فيه خطط صالحة  → القسم كامل بخططه (اللي بتنفع بس).
///  - مفيش وفيه سبب يهم العميل (تقديم تحت المراجعة/متفعّل) → سطر حالة صغير مش بانر تقديم.
///  - مفيش خالص      → القسم بيختفي تمامًا.
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
  InstallmentOptions? _options;
  InstallmentPlan? _selectedPlan;
  List<InstallmentPolicy> _policies = [];
  List<SavedPaymentMethod> _paymentMethods = [];
  String? _selectedPaymentMethodId;
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
      final options = await repo.fetchOptionsForOrder(widget.orderId);
      // الشروط ووسائل الدفع مالهاش لازمة لو مفيش خطة صالحة أصلاً — بنوفّر نداءين شبكة.
      if (options.plans.isEmpty) {
        if (mounted) setState(() => _options = options);
        return;
      }
      final policies = await repo.fetchPolicies(widget.serviceId);
      final methods = await PaymentMethodsRepository(widget.auth).list();
      if (mounted) {
        setState(() {
          _options = options;
          _policies = policies;
          _paymentMethods = methods;
          final defaults = methods.where((method) => method.isDefault);
          _selectedPaymentMethodId =
              defaults.isNotEmpty ? defaults.first.id : (methods.isNotEmpty ? methods.first.id : null);
        });
      }
    } on ApiException {
      // فشل الفحص = ما نعرضش بانر ممكن يفشل — نفس نتيجة "مش متاح" بالظبط.
      if (mounted) setState(() => _options = InstallmentOptions.empty);
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
        acceptedPolicyVersionIds:
            _policies.where((policy) => policy.isRequired).map((policy) => policy.currentVersionId).toList(),
        paymentMethodId: _selectedPlan!.requiresSavedCard ? _selectedPaymentMethodId : null,
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
    final options = _options;
    if (options == null) return const SizedBox.shrink();
    final plans = options.plans;
    if (plans.isEmpty) {
      if (!options.hasCustomerFacingStatus) return const SizedBox.shrink();
      return Card(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: ListTile(
          leading: Icon(
            options.reasonCode == 'application_approved'
                ? Icons.check_circle_outline
                : Icons.schedule_outlined,
          ),
          title: const Text('التقسيط'),
          subtitle: Text(options.reasonAr ?? ''),
        ),
      );
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('ادفع بالتقسيط', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...plans.map((plan) => Card(
                  color: _selectedPlan?.id == plan.id
                      ? Theme.of(context).colorScheme.primaryContainer
                      : null,
                  child: ListTile(
                    onTap: () => setState(() {
                      _selectedPlan = plan;
                      final compatible = _paymentMethods
                          .where((method) => method.provider == plan.allowedProvider);
                      _selectedPaymentMethodId = compatible.any(
                              (method) => method.id == _selectedPaymentMethodId)
                          ? _selectedPaymentMethodId
                          : (compatible.isNotEmpty ? compatible.first.id : null);
                    }),
                    leading: Icon(
                      _selectedPlan?.id == plan.id
                          ? Icons.radio_button_checked
                          : Icons.radio_button_unchecked,
                    ),
                    title: Text(plan.nameAr),
                    subtitle: Text(
                      '${plan.installmentCount} أقساط كل ${plan.intervalDays} يوم'
                      '${plan.financingPercentage > 0 ? ' · تمويل ${plan.financingPercentage.toStringAsFixed(0)}%' : ''}'
                      '${plan.downPaymentPercentage > 0 ? ' · مقدم ${plan.downPaymentPercentage.toStringAsFixed(0)}%' : ''}',
                    ),
                  ),
                )),
            if (_selectedPlan != null) ...[
              const SizedBox(height: 8),
              if (_selectedPlan!.requiresSavedCard) ...[
                if (_paymentMethods
                    .where((method) => method.provider == _selectedPlan!.allowedProvider)
                    .isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text(
                      'الخطة تحتاج بطاقة Paymob محفوظة. ادفع مرة بالكارت مع اختيار الحفظ ثم ارجع للتقديم.',
                      style: TextStyle(color: Colors.red),
                    ),
                  )
                else
                  DropdownButtonFormField<String>(
                    key: ValueKey(_selectedPlan!.id),
                    initialValue: _paymentMethods.any((method) =>
                            method.id == _selectedPaymentMethodId &&
                            method.provider == _selectedPlan!.allowedProvider)
                        ? _selectedPaymentMethodId
                        : null,
                    decoration: const InputDecoration(labelText: 'بطاقة التحصيل التلقائي'),
                    items: _paymentMethods
                        .where((method) => method.provider == _selectedPlan!.allowedProvider)
                        .map((method) => DropdownMenuItem(
                              value: method.id,
                              child: Text('${method.cardBrand ?? 'بطاقة'} ${method.maskedPan ?? ''}'),
                            ))
                        .toList(),
                    onChanged: (value) => setState(() => _selectedPaymentMethodId = value),
                  ),
                const SizedBox(height: 8),
              ],
              if (_policies.isNotEmpty)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('شروط التقسيط'),
                  children: _policies
                      .map((policy) => ListTile(
                            dense: true,
                            title: Text(policy.titleAr),
                            subtitle: Text(policy.bodyAr),
                          ))
                      .toList(),
                ),
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
                  onPressed: _submitting ||
                          !_accepted ||
                          (_selectedPlan!.requiresSavedCard &&
                              !_paymentMethods.any((method) =>
                                  method.id == _selectedPaymentMethodId &&
                                  method.provider == _selectedPlan!.allowedProvider))
                      ? null
                      : _submit,
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
