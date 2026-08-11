import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart';
import '../technicians/models.dart';
import '../technicians/technicians_repository.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';

class CreateOrderScreen extends StatefulWidget {
  final CatalogService service;
  final BookingMode bookingMode;
  final String? requestedTechnicianId;

  const CreateOrderScreen({super.key, required this.service, required this.bookingMode, this.requestedTechnicianId});

  @override
  State<CreateOrderScreen> createState() => _CreateOrderScreenState();
}

class _CreateOrderScreenState extends State<CreateOrderScreen> {
  late final OrdersRepository _repository;
  late final TechniciansRepository _techniciansRepository;
  final _catalogRepository = CatalogRepository();
  final _descriptionController = TextEditingController();
  final _promoController = TextEditingController();
  Address? _selectedAddress;
  bool _submitting = false;
  bool _validatingPromo = false;
  int? _promoDiscountCents;
  String? _promoError;
  String? _error;
  List<ServiceAddon> _addons = [];
  final Set<String> _selectedAddonIds = {};
  // "اعتماد" (docs/06 §1.5) — اختياري، بس متاح لما bookingMode=team بس.
  List<TechnicianCompanySummary>? _companies;
  TechnicianCompanySummary? _selectedCompany;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _techniciansRepository = TechniciansRepository(context.read<AuthRepository>());
    _loadAddons();
    if (widget.bookingMode == BookingMode.team) _loadCompanies();
  }

  // فشل تحميل الشركات مش لازم يمنع الحجز نفسه — العميل يقدر يسيب المطابقة تختار له فني/فريق
  // مؤهّل تلقائيًا (نفس فلسفة _loadAddons تحت).
  Future<void> _loadCompanies() async {
    try {
      final companies = await _techniciansRepository.listActiveCompanies();
      if (mounted) setState(() => _companies = companies);
    } on ApiException {
      // تجاهل — اختيار الشركة اختياري بحتة
    }
  }

  // كانت فجوة موثّقة صراحة في catalog/README.md — الباك-إند (POST /orders بياخد addon_ids[])
  // كان جاهز ومختبر من غير أي UI يستخدمه. فشل تحميل الإضافات مش لازم يمنع إنشاء الطلب نفسه.
  Future<void> _loadAddons() async {
    try {
      final addons = await _catalogRepository.fetchAddons(widget.service.id);
      if (mounted) setState(() => _addons = addons);
    } on ApiException {
      // تجاهل — الإضافات اختيارية بحتة، العميل لسه يقدر يكمل الطلب من غيرها
    }
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address != null) {
      setState(() {
        _selectedAddress = address;
        // العنوان اتغيّر — أي معاينة خصم قديمة بقت مش موثوقة (النطاق ممكن يختلف).
        _promoDiscountCents = null;
        _promoError = null;
      });
    }
  }

  Future<void> _validatePromo() async {
    final code = _promoController.text.trim();
    if (code.isEmpty) return;
    if (_selectedAddress == null) {
      setState(() => _promoError = 'اختار عنوان الأول');
      return;
    }
    setState(() {
      _validatingPromo = true;
      _promoError = null;
      _promoDiscountCents = null;
    });
    try {
      final result = await _repository.validatePromoCode(
        code: code,
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
      );
      if (mounted) setState(() => _promoDiscountCents = result['discount_cents'] as int);
    } on ApiException catch (err) {
      if (mounted) setState(() => _promoError = err.message);
    } finally {
      if (mounted) setState(() => _validatingPromo = false);
    }
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
        bookingMode: widget.bookingMode,
        problemDescription: _descriptionController.text.trim(),
        promoCode: _promoController.text.trim(),
        addonIds: _selectedAddonIds.toList(),
        requestedTechnicianId: widget.requestedTechnicianId,
        requestedTechnicianCompanyId: _selectedCompany?.id,
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
            if (_addons.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('إضافات اختيارية', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Column(
                  children: _addons
                      .map(
                        (addon) => CheckboxListTile(
                          value: _selectedAddonIds.contains(addon.id),
                          onChanged: (checked) => setState(() {
                            if (checked == true) {
                              _selectedAddonIds.add(addon.id);
                            } else {
                              _selectedAddonIds.remove(addon.id);
                            }
                          }),
                          title: Text(addon.nameAr),
                          secondary: Text('+${_formatEgp(addon.priceCents)}'),
                        ),
                      )
                      .toList(),
                ),
              ),
            ],
            if (widget.bookingMode == BookingMode.team && (_companies?.isNotEmpty ?? false)) ...[
              const SizedBox(height: 16),
              Text('اختار شركة/فريق (اختياري)', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Column(
                  children: [
                    RadioListTile<TechnicianCompanySummary?>(
                      value: null,
                      groupValue: _selectedCompany,
                      onChanged: (value) => setState(() => _selectedCompany = value),
                      title: const Text('بدون تفضيل — نختارلك أنسب فريق متاح'),
                    ),
                    ..._companies!.map(
                      (company) => RadioListTile<TechnicianCompanySummary?>(
                        value: company,
                        groupValue: _selectedCompany,
                        onChanged: (value) => setState(() => _selectedCompany = value),
                        title: Text(company.name),
                        subtitle: Text('${company.staffCount} فني · ${company.branchCount} فرع'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _promoController,
                    decoration: const InputDecoration(
                      labelText: 'كود خصم (اختياري)',
                      border: OutlineInputBorder(),
                    ),
                    textCapitalization: TextCapitalization.characters,
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _validatingPromo ? null : _validatePromo,
                  child: _validatingPromo
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('تحقق'),
                ),
              ],
            ),
            if (_promoError != null) ...[
              const SizedBox(height: 4),
              Text(_promoError!, style: const TextStyle(color: Colors.red)),
            ],
            if (_promoDiscountCents != null) ...[
              const SizedBox(height: 4),
              Text(
                'هيتخصم ${(_promoDiscountCents! / 100).toStringAsFixed(0)} ج.م. من السعر',
                style: const TextStyle(color: Colors.green),
              ),
            ],
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
