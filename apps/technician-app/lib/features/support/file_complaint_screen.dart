import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'support_repository.dart';

// فتح شكوى جديدة — إما مربوطة بطلب محدد (orderId مُمرَّر من OrderExecutionScreen) أو عامة.
// §24 — نمط مطابق لـ apps/customer-app/lib/features/support/file_complaint_screen.dart، بفارق
// واحد مقصود: مفيش "اختار من قايمة طلباتك" هنا لأن apps/technician-app معندهاش endpoint لعرض كل
// طلبات الفني التاريخية (بس الطلب الشغال حاليًا GET /technician/orders/active) — شكوى عن طلب
// معيّن بتتفتح من شاشة تنفيذ الطلب نفسها (orderId مُمرَّر)، شكوى عامة بلا طلب متاحة دايمًا.
class FileComplaintScreen extends StatefulWidget {
  final String? orderId;

  const FileComplaintScreen({super.key, this.orderId});

  @override
  State<FileComplaintScreen> createState() => _FileComplaintScreenState();
}

class _FileComplaintScreenState extends State<FileComplaintScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  ComplaintCategory _category = ComplaintCategory.other;
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final complaint = await SupportRepository(context.read<AuthRepository>()).file(
        orderId: widget.orderId,
        category: _category,
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(complaint);
    } on ApiException catch (err) {
      setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('فتح شكوى')),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (widget.orderId == null)
                const Padding(
                  padding: EdgeInsets.only(bottom: 16),
                  child: Text(
                    'الشكوى دي عامة (بلا طلب محدد). لو المشكلة عن طلب شغال حاليًا، افتح الشكوى من شاشة تنفيذ الطلب نفسها.',
                    style: TextStyle(color: Colors.grey),
                  ),
                ),
              DropdownButtonFormField<ComplaintCategory>(
                initialValue: _category,
                decoration: const InputDecoration(labelText: 'نوع المشكلة'),
                items: ComplaintCategory.values
                    .map((c) => DropdownMenuItem(value: c, child: Text(c.labelAr)))
                    .toList(),
                onChanged: (value) => setState(() => _category = value ?? ComplaintCategory.other),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(labelText: 'عنوان مختصر للمشكلة'),
                validator: (value) =>
                    (value == null || value.trim().length < 3) ? 'العنوان لازم يكون 3 حروف على الأقل' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descriptionController,
                decoration: const InputDecoration(labelText: 'تفاصيل المشكلة'),
                maxLines: 5,
                validator: (value) =>
                    (value == null || value.trim().length < 10) ? 'التفاصيل لازم تكون 10 حروف على الأقل' : null,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('إرسال الشكوى'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
