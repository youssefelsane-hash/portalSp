import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'support_repository.dart';

class CreateSupportTicketScreen extends StatefulWidget {
  const CreateSupportTicketScreen({super.key});

  @override
  State<CreateSupportTicketScreen> createState() =>
      _CreateSupportTicketScreenState();
}

class _CreateSupportTicketScreenState extends State<CreateSupportTicketScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subjectController = TextEditingController();
  String _category = 'general';
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final ticket = await SupportRepository(context.read<AuthRepository>())
          .createTicket(
            subject: _subjectController.text.trim(),
            category: _category,
          );
      if (mounted) Navigator.of(context).pop(ticket);
    } catch (error) {
      final apiError = ApiException.from(error);
      if (mounted) setState(() => _error = apiError.displayMessage);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _subjectController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('تذكرة دعم جديدة')),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'لو عندك مشكلة في طلب معيّن، افتح شكوى من صفحة الطلب. التذكرة هنا للاستفسارات العامة أو مشاكل الحساب والتطبيق.',
                style: TextStyle(height: 1.6),
              ),
              const SizedBox(height: 20),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _category,
                decoration: const InputDecoration(labelText: 'نوع المساعدة'),
                items: supportTicketCategoryLabelsAr.entries
                    .map(
                      (entry) => DropdownMenuItem(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setState(() => _category = value ?? 'general'),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _subjectController,
                decoration: const InputDecoration(
                  labelText: 'اكتب مشكلتك أو سؤالك',
                  hintText: 'مثال: مش قادر أضيف وسيلة دفع جديدة',
                  alignLabelWithHint: true,
                ),
                minLines: 3,
                maxLines: 6,
                maxLength: 200,
                validator: (value) {
                  final length = value?.trim().length ?? 0;
                  if (length < 3) {
                    return 'اكتب 3 حروف على الأقل عشان نقدر نساعدك';
                  }
                  return null;
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('إرسال التذكرة'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
