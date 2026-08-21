import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart';
import '../catalog/pricing_field_widgets.dart';
import '../support/support_contact_screen.dart';
import '../technicians/technician_selection_screen.dart';

// P0-10 (2026-08-13، مراجعة أمان/جودة شاملة) — كانت فجوة حقيقية موثّقة: لخدمات pricing_model=
// formula، رحلة الحجز كانت "اختار فني → دخّل تفاصيل الشغل" (services_screen.dart كان بيودّي على
// طول لـTechnicianSelectionScreen)، يعني قايمة الفنيين كانت بتعرض كل الفنيين "بدون سعر نهائي"
// خالص — GET /services/:id/technicians محتاج field_values عشان يقدر يحسب final_price_cents لكل
// فني (راجع catalog.controller.ts). الشاشة دي بتقلب الترتيب لخدمات formula بس: عنوان + تفاصيل
// الشغل الأول، بعدين قايمة الفنيين وهي شايفة السعر النهائي الحقيقي فعليًا لكل واحد.
class JobDetailsScreen extends StatefulWidget {
  final CatalogService service;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — اتحددت قبل الشاشة دي (catalog_navigation.dart)،
  // بتتمرر جاهزة لحد ما توصل لـTechnicianSelectionScreen/CreateOrderScreen.
  final DateTime? requestedAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3) — null يعني يوم محدد واحد بس.
  final DateTime? requestedAtRangeEnd;
  // توحيد فلو "اعتماد" مع "فردي" (docs/08 §38) — بتتمرر جاهزة لـTechnicianSelectionScreen.
  final BookingMode bookingMode;

  const JobDetailsScreen({
    super.key,
    required this.service,
    this.requestedAt,
    this.requestedAtRangeEnd,
    this.bookingMode = BookingMode.individual,
  });

  @override
  State<JobDetailsScreen> createState() => _JobDetailsScreenState();
}

class _JobDetailsScreenState extends State<JobDetailsScreen> {
  final _catalogRepository = CatalogRepository();
  Address? _selectedAddress;
  List<PricingField> _pricingFields = [];
  bool _loadingPricingFields = false;
  String? _pricingFieldsError;
  final Map<String, dynamic> _fieldValues = {};

  @override
  void initState() {
    super.initState();
    _loadPricingFields();
    // بَقّة حقيقية اتلقطت بالتشغيل الحي (Xvfb+fluxbox، 2026-08-19): نداء Navigator.push هنا
    // مباشرة جوّه initState بيحصل وهو الـNavigator لسه في نص انيميشن الدخول لـJobDetailsScreen
    // نفسها (لسه locked) — بيرمي 'navigator._debugLocked' assertion جوّه microtask، والشاشة
    // بتفضل "ميتة" تمامًا لأي لمسة بعد كده (كل تفاعل تاني مع الـNavigator بيرمي نفس الاستثناء
    // بصمت). addPostFrameCallback بيأجّل النداء لحد ما الفريم الحالي وانيميشن الدخول يخلصوا.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _pickAddress();
    });
  }

  Future<void> _loadPricingFields() async {
    setState(() => _loadingPricingFields = true);
    try {
      final fields = await _catalogRepository.fetchPricingFields(widget.service.id);
      if (mounted) setState(() => _pricingFields = fields);
    } on ApiException catch (err) {
      if (mounted) setState(() => _pricingFieldsError = err.message);
    } finally {
      if (mounted) setState(() => _loadingPricingFields = false);
    }
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address == null) {
      // العميل رجع من غير ما يختار عنوان — مفيش داعي نفضل في شاشة فاضية، نرجعه للخلف.
      if (mounted) Navigator.of(context).pop();
      return;
    }
    if (mounted) setState(() => _selectedAddress = address);
  }

  // نفس فحص CreateOrderScreen._pricingFieldsComplete بالحرف (PricingEngineService.evaluate()
  // في الباك-إند بيرفض واضح لو حقل مطلوب ناقص — هنا عشان نعرف إمتى نسمح بمتابعة القايمة).
  bool get _pricingFieldsComplete => _pricingFields
      .where((f) => f.isRequired && f.isSupported)
      .every((f) => _fieldValues[f.fieldKey] != null && _fieldValues[f.fieldKey] != '');

  bool get _hasUnsupportedRequiredField => _pricingFields.any((f) => f.isRequired && !f.isSupported);

  void _onFieldValueChanged(String fieldKey, dynamic value) {
    setState(() {
      if (value == null || value == '') {
        _fieldValues.remove(fieldKey);
      } else {
        _fieldValues[fieldKey] = value;
      }
    });
  }

  void _continueToTechnicians() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TechnicianSelectionScreen(
          service: widget.service,
          initialAddress: _selectedAddress,
          fieldValues: Map<String, dynamic>.from(_fieldValues),
          requestedAt: widget.requestedAt,
          requestedAtRangeEnd: widget.requestedAtRangeEnd,
          bookingMode: widget.bookingMode,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canContinue = _selectedAddress != null && _pricingFieldsComplete && !_hasUnsupportedRequiredField;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('تفاصيل الشغل: ${widget.service.nameAr}')),
        body: _selectedAddress == null
            ? const SizedBox.shrink() // لسه بيختار عنوان (AddressesScreen فوقها)
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          _selectedAddress!.displayTitle,
                          style: Theme.of(context).textTheme.titleMedium,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      TextButton.icon(
                        onPressed: _pickAddress,
                        icon: const Icon(Icons.edit_location_alt_outlined, size: 18),
                        label: const Text('تغيير العنوان'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'دخّل تفاصيل الشغل عشان نقدر نعرضلك السعر النهائي الحقيقي لكل فني في القايمة',
                    style: TextStyle(color: Colors.grey),
                  ),
                  const SizedBox(height: 16),
                  if (_loadingPricingFields)
                    const Center(child: CircularProgressIndicator())
                  else if (_pricingFieldsError != null)
                    Text(_pricingFieldsError!, style: const TextStyle(color: Colors.red))
                  else
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: (List.of(_pricingFields)..sort((a, b) => a.fieldKey.compareTo(b.fieldKey)))
                              .map((field) => buildPricingFieldWidget(context, field, _fieldValues, _onFieldValueChanged))
                              .toList(),
                        ),
                      ),
                    ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: canContinue ? _continueToTechnicians : null,
                    child: const Text('متابعة — اختار الفني'),
                  ),
                  // مساعدة حجز بسيطة (docs/08 §22 addendum) — كانت فجوة حقيقية: النص ده كان بيقول
                  // "كلم الدعم" بلا أي زرار فعلي وراه، العميل يقرأ التعليمة ومالوش طريقة ينفّذها.
                  if (_hasUnsupportedRequiredField) ...[
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        'الخدمة دي محتاجة تفاصيل (صور/موقع) مش مدعومة في التطبيق لسه',
                        style: TextStyle(color: Colors.red),
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const SupportContactScreen()),
                      ),
                      icon: const Icon(Icons.support_agent_outlined),
                      label: const Text('كلّمنا نكمّل الحجز يدويًا'),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}
