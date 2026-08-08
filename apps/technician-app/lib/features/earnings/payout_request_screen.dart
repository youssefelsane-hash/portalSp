import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import 'earnings_repository.dart';
import 'models.dart';

class PayoutRequestScreen extends StatefulWidget {
  final EarningsRepository repository;
  final int availableBalanceCents;

  const PayoutRequestScreen({super.key, required this.repository, required this.availableBalanceCents});

  @override
  State<PayoutRequestScreen> createState() => _PayoutRequestScreenState();
}

class _PayoutRequestScreenState extends State<PayoutRequestScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _destinationController = TextEditingController();
  String _method = 'vodafone_cash';
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final amountEgp = double.parse(_amountController.text.trim());
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final payout = await widget.repository.requestPayout(
        amountCents: (amountEgp * 100).round(),
        payoutMethod: _method,
        destinationMasked: _destinationController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(payout);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final availableEgp = (widget.availableBalanceCents / 100).toStringAsFixed(0);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('طلب صرف')),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('الرصيد المتاح: $availableEgp ج.م.', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              TextFormField(
                controller: _amountController,
                decoration: const InputDecoration(labelText: 'المبلغ (ج.م.)'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  final parsed = double.tryParse(value ?? '');
                  if (parsed == null || parsed <= 0) return 'مبلغ غير صحيح';
                  return null;
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _method,
                decoration: const InputDecoration(labelText: 'طريقة الصرف'),
                items: payoutMethodLabelsAr.entries
                    .map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value)))
                    .toList(),
                onChanged: (value) => setState(() => _method = value!),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _destinationController,
                decoration: const InputDecoration(labelText: 'رقم المحفظة/الحساب (اختياري)'),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('تأكيد طلب الصرف'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
