import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../orders/models.dart' as orders_models;
import '../orders/orders_repository.dart';
import 'models.dart';
import 'support_repository.dart';

// فتح شكوى جديدة — إما مربوطة بطلب محدد (orderId مُمرَّر من OrderDetailScreen) أو عامة (العميل
// بيختار من قايمة طلباته، أو يسيبها بلا طلب خالص — order_id اختياري في الباك-إند).
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
  String? _selectedOrderId;
  List<orders_models.Order>? _orders;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedOrderId = widget.orderId;
    if (widget.orderId == null) {
      _loadOrders();
    }
  }

  Future<void> _loadOrders() async {
    try {
      final orders = await OrdersRepository(context.read<AuthRepository>()).list();
      if (mounted) setState(() => _orders = orders);
    } on ApiException {
      // فشل تحميل القايمة مش لازم يمنع فتح شكوى عامة بلا طلب محدد.
      if (mounted) setState(() => _orders = []);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final complaint = await SupportRepository(context.read<AuthRepository>()).file(
        orderId: _selectedOrderId,
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
              if (widget.orderId == null && _orders != null && _orders!.isNotEmpty)
                DropdownButtonFormField<String?>(
                  initialValue: _selectedOrderId,
                  decoration: const InputDecoration(labelText: 'الطلب (اختياري)'),
                  items: [
                    const DropdownMenuItem<String?>(value: null, child: Text('بدون طلب محدد')),
                    ..._orders!.map(
                      (o) => DropdownMenuItem<String?>(value: o.id, child: Text('طلب #${o.orderNumber}')),
                    ),
                  ],
                  onChanged: (value) => setState(() => _selectedOrderId = value),
                ),
              const SizedBox(height: 16),
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
