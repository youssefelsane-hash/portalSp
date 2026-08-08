import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';

class CreateOrderScreen extends StatefulWidget {
  final CatalogService service;

  const CreateOrderScreen({super.key, required this.service});

  @override
  State<CreateOrderScreen> createState() => _CreateOrderScreenState();
}

class _CreateOrderScreenState extends State<CreateOrderScreen> {
  late final OrdersRepository _repository;
  final _descriptionController = TextEditingController();
  Address? _selectedAddress;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address != null) setState(() => _selectedAddress = address);
  }

  Future<void> _submit() async {
    if (_selectedAddress == null) {
      setState(() => _error = 'اختار عنوان الأول');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final order = await _repository.create(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        problemDescription: _descriptionController.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: order.id)),
        );
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('طلب: ${widget.service.nameAr}')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: ListTile(
                title: Text(widget.service.nameAr),
                subtitle: Text('السعر التقريبي: ${_formatEgp(widget.service.basePriceCents)}'),
              ),
            ),
            const SizedBox(height: 16),
            Text('عنوان الطلب', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: ListTile(
                title: Text(_selectedAddress?.displayTitle ?? 'اختار عنوان'),
                subtitle: _selectedAddress != null ? Text(_selectedAddress!.streetName) : null,
                trailing: const Icon(Icons.chevron_left),
                onTap: _pickAddress,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'وصف المشكلة (اختياري)',
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('تأكيد الطلب'),
            ),
          ],
        ),
      ),
    );
  }
}
