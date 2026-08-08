import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../geo/geo_repository.dart';
import '../geo/models.dart' as geo;
import 'addresses_repository.dart';

class AddressFormScreen extends StatefulWidget {
  final AddressesRepository repository;

  const AddressFormScreen({super.key, required this.repository});

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  final _geoRepository = GeoRepository();
  final _formKey = GlobalKey<FormState>();

  List<geo.City>? _cities;
  List<geo.Area>? _areas;
  String? _cityId;
  String? _areaId;

  final _labelController = TextEditingController();
  final _streetController = TextEditingController();
  final _buildingController = TextEditingController();
  final _landmarkController = TextEditingController();
  final _latController = TextEditingController();
  final _lngController = TextEditingController();

  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCities();
  }

  Future<void> _loadCities() async {
    try {
      final cities = await _geoRepository.fetchCities();
      if (mounted) setState(() => _cities = cities);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _loadAreas(String cityId) async {
    setState(() {
      _areaId = null;
      _areas = null;
    });
    try {
      final areas = await _geoRepository.fetchAreas(cityId);
      if (mounted) setState(() => _areas = areas);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || _cityId == null || _areaId == null) {
      setState(() => _error = 'من فضلك اختار المدينة والمنطقة');
      return;
    }
    final lat = double.tryParse(_latController.text.trim());
    final lng = double.tryParse(_lngController.text.trim());
    if (lat == null || lng == null) {
      setState(() => _error = 'الإحداثيات لازم تكون أرقام صحيحة');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final address = await widget.repository.create(
        cityId: _cityId!,
        areaId: _areaId!,
        streetName: _streetController.text.trim(),
        latitude: lat,
        longitude: lng,
        label: _labelController.text.trim(),
        buildingNumber: _buildingController.text.trim(),
        landmark: _landmarkController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(address);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('إضافة عنوان جديد')),
        body: _cities == null && _error == null
            ? const Center(child: CircularProgressIndicator())
            : Form(
                key: _formKey,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(_error!, style: const TextStyle(color: Colors.red)),
                      ),
                    TextFormField(
                      controller: _labelController,
                      decoration: const InputDecoration(labelText: 'اسم العنوان (مثلاً: البيت)'),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: _cityId,
                      decoration: const InputDecoration(labelText: 'المدينة'),
                      items: (_cities ?? [])
                          .map((c) => DropdownMenuItem(value: c.id, child: Text(c.nameAr)))
                          .toList(),
                      onChanged: (value) {
                        setState(() => _cityId = value);
                        if (value != null) _loadAreas(value);
                      },
                      validator: (value) => value == null ? 'مطلوب' : null,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: _areaId,
                      decoration: const InputDecoration(labelText: 'المنطقة'),
                      items: (_areas ?? [])
                          .map((a) => DropdownMenuItem(value: a.id, child: Text(a.nameAr)))
                          .toList(),
                      onChanged: _areas == null ? null : (value) => setState(() => _areaId = value),
                      validator: (value) => value == null ? 'مطلوب' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _streetController,
                      decoration: const InputDecoration(labelText: 'اسم الشارع'),
                      validator: (value) => (value == null || value.trim().length < 2) ? 'مطلوب' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _buildingController,
                      decoration: const InputDecoration(labelText: 'رقم المبنى (اختياري)'),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _landmarkController,
                      decoration: const InputDecoration(labelText: 'علامة مميزة (اختياري)'),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _latController,
                            decoration: const InputDecoration(labelText: 'خط العرض (latitude)'),
                            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                            validator: (value) => double.tryParse(value ?? '') == null ? 'رقم غير صحيح' : null,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: _lngController,
                            decoration: const InputDecoration(labelText: 'خط الطول (longitude)'),
                            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                            validator: (value) => double.tryParse(value ?? '') == null ? 'رقم غير صحيح' : null,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _saving ? null : _submit,
                      child: _saving
                          ? const SizedBox(
                              width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('حفظ العنوان'),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
