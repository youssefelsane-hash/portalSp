import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_repository.dart';
import '../addresses/models.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart';
import 'models.dart';
import 'recurring_orders_repository.dart';

// الطلبات المتكررة (docs/08 §11) — كانت فجوة موثّقة صراحة: API كامل (إنشاء/عرض/إيقاف/حذف)
// موجود ومختبر في الباك-إند من زمان، بس مفيش شاشة في apps/customer-app كانت بتستخدمه — العميل
// كان مضطر يحجز كل مرة يدويًا حتى لو الخدمة (مثلاً تنظيف شهري) متكررة فعليًا.
class RecurringOrdersScreen extends StatefulWidget {
  const RecurringOrdersScreen({super.key});

  @override
  State<RecurringOrdersScreen> createState() => _RecurringOrdersScreenState();
}

class _RecurringOrdersScreenState extends State<RecurringOrdersScreen> {
  late final RecurringOrdersRepository _repository;
  late final AddressesRepository _addressesRepository;
  final _catalogRepository = CatalogRepository();
  List<RecurringTemplate>? _templates;
  List<Address> _addresses = [];
  List<CatalogService> _services = [];
  String? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = RecurringOrdersRepository(auth);
    _addressesRepository = AddressesRepository(auth);
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repository.list(), _addressesRepository.list(), _catalogRepository.fetchServices()]);
      if (mounted) {
        setState(() {
          _templates = results[0] as List<RecurringTemplate>;
          _addresses = results[1] as List<Address>;
          _services = results[2] as List<CatalogService>;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _serviceName(String serviceId) {
    for (final service in _services) {
      if (service.id == serviceId) return service.nameAr;
    }
    return serviceId;
  }

  String _addressLabel(String addressId) {
    for (final address in _addresses) {
      if (address.id == addressId) return address.label ?? address.streetName;
    }
    return addressId;
  }

  Future<void> _toggleActive(RecurringTemplate template) async {
    setState(() => _acting = true);
    try {
      await _repository.setActive(template.id, !template.isActive);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _remove(RecurringTemplate template) async {
    setState(() => _acting = true);
    try {
      await _repository.remove(template.id);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _openCreateSheet() async {
    if (_services.isEmpty || _addresses.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('محتاج تضيف عنوان واحد على الأقل عشان تنشئ قالب متكرر')),
      );
      return;
    }
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _CreateTemplateSheet(repository: _repository, services: _services, addresses: _addresses),
    );
    if (result == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الطلبات المتكررة')),
        floatingActionButton: FloatingActionButton(onPressed: _openCreateSheet, child: const Icon(Icons.add)),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _templates == null
                  ? const Center(child: CircularProgressIndicator())
                  : _templates!.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 80),
                            Center(child: Text('مفيش طلبات متكررة لسه')),
                          ],
                        )
                      : ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            for (final template in _templates!)
                              Card(
                                child: ListTile(
                                  title: Text(_serviceName(template.serviceId)),
                                  subtitle: Text(
                                    '${_addressLabel(template.addressId)}\n'
                                    '${recurringFrequencyLabelsAr[template.frequency] ?? template.frequency} — '
                                    'الموعد الجاي: ${template.nextRunAt.substring(0, 10)}',
                                  ),
                                  isThreeLine: true,
                                  trailing: PopupMenuButton<String>(
                                    onSelected: (value) {
                                      if (value == 'toggle') {
                                        _toggleActive(template);
                                      } else if (value == 'remove') {
                                        _remove(template);
                                      }
                                    },
                                    itemBuilder: (context) => [
                                      PopupMenuItem(
                                        value: 'toggle',
                                        child: Text(template.isActive ? 'إيقاف مؤقت' : 'استئناف'),
                                      ),
                                      const PopupMenuItem(value: 'remove', child: Text('حذف')),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
        ),
      ),
    );
  }
}

class _CreateTemplateSheet extends StatefulWidget {
  final RecurringOrdersRepository repository;
  final List<CatalogService> services;
  final List<Address> addresses;

  const _CreateTemplateSheet({required this.repository, required this.services, required this.addresses});

  @override
  State<_CreateTemplateSheet> createState() => _CreateTemplateSheetState();
}

class _CreateTemplateSheetState extends State<_CreateTemplateSheet> {
  String? _serviceId;
  String? _addressId;
  String _frequency = 'monthly';
  DateTime? _startsAt;
  final _descriptionController = TextEditingController();
  String? _error;
  bool _submitting = false;

  Future<void> _pickStartDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now().add(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _startsAt = picked);
  }

  Future<void> _submit() async {
    if (_serviceId == null || _addressId == null || _startsAt == null) {
      setState(() => _error = 'اختار الخدمة والعنوان وأول موعد');
      return;
    }
    final service = widget.services.firstWhere((s) => s.id == _serviceId);
    final bookingMode = service.defaultAllowedBookingMode;
    if (bookingMode == null) {
      setState(() => _error = 'الخدمة دي مش متاحة لأي وضع حجز حاليًا');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.repository.create(
        serviceId: _serviceId!,
        addressId: _addressId!,
        bookingMode: bookingMode,
        frequency: _frequency,
        startsAt: _startsAt!.toIso8601String(),
        problemDescription: _descriptionController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
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
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('طلب متكرر جديد', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _serviceId,
                decoration: const InputDecoration(labelText: 'الخدمة', border: OutlineInputBorder()),
                items: [
                  for (final service in widget.services)
                    if (service.defaultAllowedBookingMode != null)
                      DropdownMenuItem(value: service.id, child: Text(service.nameAr)),
                ],
                onChanged: (value) => setState(() => _serviceId = value),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _addressId,
                decoration: const InputDecoration(labelText: 'العنوان', border: OutlineInputBorder()),
                items: [
                  for (final address in widget.addresses)
                    DropdownMenuItem(value: address.id, child: Text(address.label ?? address.streetName)),
                ],
                onChanged: (value) => setState(() => _addressId = value),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _frequency,
                decoration: const InputDecoration(labelText: 'التكرار', border: OutlineInputBorder()),
                items: [
                  for (final entry in recurringFrequencyLabelsAr.entries)
                    DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                ],
                onChanged: (value) => setState(() => _frequency = value ?? 'monthly'),
              ),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_startsAt != null ? _startsAt!.toIso8601String().substring(0, 10) : 'اختار أول موعد'),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: _pickStartDate,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _descriptionController,
                decoration: const InputDecoration(labelText: 'وصف المشكلة (اختياري)', border: OutlineInputBorder()),
                maxLines: 2,
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('إنشاء'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
