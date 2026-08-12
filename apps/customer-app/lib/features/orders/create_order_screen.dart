import 'dart:async';

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
import 'models.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';

class CreateOrderScreen extends StatefulWidget {
  final CatalogService service;
  final BookingMode bookingMode;
  final String? requestedTechnicianId;
  // الجدولة الحقيقية للفني (docs/08 §2-§3) — العميل اختار سلوت محدد من TechnicianProfileScreen.
  // requestedTechnicianId مش لازم يتبعت معاها (الباك-إند بيستنتجه من السلوت نفسه)، بس لو اتبعت
  // برضه لازم تكون بتاعة نفس فني السلوت وإلا الطلب هيترفض بوضوح.
  final String? scheduleSlotId;
  // اختيار الفني قبل الحجز (docs/08 §3) — TechnicianSelectionScreen بتخلي العميل يختار عنوان
  // الأول عشان تجيبله قايمة الفنيين (GET /services/:id/technicians محتاج address_id)؛ بنمررها
  // هنا عشان العميل ميضطرش يختارها تاني هنا — تجربة استخدام أسوأ لو كررناها.
  final Address? initialAddress;

  const CreateOrderScreen({
    super.key,
    required this.service,
    required this.bookingMode,
    this.requestedTechnicianId,
    this.scheduleSlotId,
    this.initialAddress,
  });

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
  String? _promoError;
  String? _error;
  List<ServiceAddon> _addons = [];
  final Set<String> _selectedAddonIds = {};
  // "اعتماد" (docs/06 §1.5) — اختياري، بس متاح لما bookingMode=team بس.
  List<TechnicianCompanySummary>? _companies;
  TechnicianCompanySummary? _selectedCompany;

  // محرك التسعير الديناميكي (docs/08 §1) — كانت فجوة موثّقة صراحة: apps/customer-app مفيهوش
  // شاشة تدخل بيها القيم اللازمة لحساب سعر خدمات pricing_model=formula، فالعميل مكانش يقدر
  // يحجز الخدمات دي أصلاً من التطبيق (كان المسار الوحيد اختبار مباشر بـ curl). اتقفلت.
  bool get _isFormulaPricing => widget.service.pricingModel == 'formula';
  List<PricingField> _pricingFields = [];
  bool _loadingPricingFields = false;
  String? _pricingFieldsError;
  final Map<String, dynamic> _fieldValues = {};

  // تفصيل السعر الحقيقي الكامل قبل التأكيد (docs/08 §1/§2) — كانت فجوة موثّقة صراحة: الشاشة
  // كانت بتعرض إما basePriceCents الثابت (بلا تعديل منطقة/طوارئ) أو سعر formula خام (بلا رسوم
  // فحص/طوارئ ولا إضافات ولا خصم). دلوقتي مصدر واحد بس (POST /orders/preview) لكل نماذج
  // التسعير — نفس القيم بالحرف اللي POST /orders هيحسبها فعليًا. مفيش سعر يتعرض قبل ما العنوان
  // يتحدد (المنطقة جزء أساسي من السعر، عرض تخمين قبلها أخطر من عرض "بيتحسب...").
  OrderPricePreview? _pricePreview;
  bool _previewLoading = false;
  String? _previewError;
  Timer? _priceDebounce;
  // بيتغيّر مع كل نداء لـ_refreshPreview — لو نداء أقدم رجع بعد نداء أحدث (سباق حقيقي ممكن
  // يحصل: تعديل عنوان سريع ورا تعديل إضافة)، النتيجة القديمة بتتجاهل بدل ما تكتب فوق الأحدث.
  int _previewRequestGeneration = 0;

  // محرك الإنتاجية (docs/06 §3.1-§3.6) — كانت فجوة موثّقة صراحة: مفيش UI بيعرض المدة المتوقعة
  // قبل الحجز لخدمات غير formula (اللي عندها service_standard_data). مستقل تمامًا عن محرك
  // التسعير الديناميكي (نظام أقدم منفصل عمدًا) — مؤثّرش على السعر خالص، معلوماتي بس.
  List<ServiceStandardDataRow> _standardDataRows = [];
  ServiceStandardDataRow? _selectedStandardData;
  final _requestedUnitsController = TextEditingController();
  DurationEstimate? _durationEstimate;
  bool _estimatingDuration = false;
  String? _durationError;
  Timer? _durationDebounce;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _techniciansRepository = TechniciansRepository(context.read<AuthRepository>());
    _selectedAddress = widget.initialAddress;
    _loadAddons();
    if (widget.bookingMode == BookingMode.team) _loadCompanies();
    if (_isFormulaPricing) {
      _loadPricingFields();
    } else {
      _loadStandardData();
    }
    if (_selectedAddress != null) _refreshPreview();
  }

  @override
  void dispose() {
    _priceDebounce?.cancel();
    _durationDebounce?.cancel();
    _requestedUnitsController.dispose();
    super.dispose();
  }

  Future<void> _loadStandardData() async {
    try {
      final rows = await _catalogRepository.fetchStandardData(widget.service.id);
      if (mounted && rows.isNotEmpty) {
        setState(() {
          _standardDataRows = rows;
          _selectedStandardData = rows.first;
        });
      }
    } on ApiException {
      // تجاهل — المدة المتوقعة معلوماتية بس، مش لازم تمنع الحجز لو فشل تحميلها
    }
  }

  void _onRequestedUnitsChanged(String _) {
    setState(() {
      _durationEstimate = null;
      _durationError = null;
    });
    _durationDebounce?.cancel();
    _durationDebounce = Timer(const Duration(milliseconds: 500), _refreshDurationEstimate);
  }

  Future<void> _refreshDurationEstimate() async {
    final standardData = _selectedStandardData;
    final units = num.tryParse(_requestedUnitsController.text.trim());
    if (standardData == null || units == null || units <= 0) return;
    setState(() => _estimatingDuration = true);
    try {
      final result = await _catalogRepository.estimateDuration(widget.service.id, standardData.id, units);
      if (mounted) setState(() => _durationEstimate = result);
    } on ApiException catch (err) {
      if (mounted) setState(() => _durationError = err.message);
    } finally {
      if (mounted) setState(() => _estimatingDuration = false);
    }
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

  // كل حقول formula المطلوبة والمدعومة (راجع PricingField.isSupported) لازم تتملى قبل ما نقدر
  // نحسب سعر حقيقي — نفس التحقق اللي PricingEngineService.evaluate() بيعمله في الباك-إند بالظبط،
  // بس هنا عشان نقرر إمتى نستدعي evaluate-price بدل ما نبعت طلبات ناقصة تترفض كل مرة.
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
      _pricePreview = null;
      _previewError = null;
    });
    _priceDebounce?.cancel();
    _priceDebounce = Timer(const Duration(milliseconds: 500), () => _refreshPreview());
  }

  // معاينة السعر الكامل — مصدر واحد (POST /orders/preview) لكل نماذج التسعير، بدل ما كل نموذج
  // يحسب/يعرض بمنطقه الخاص. مفيش سعر حقيقي من غير عنوان (المنطقة عامل أساسي في السعر).
  // promoCode بيتبعت بس لما العميل يضغط "تحقق" صراحة (_validatePromo) — مش أوتوماتيك مع كل
  // تعديل، عشان كود غلط وسط الكتابة ميغطّيش السعر الأساسي الصحيح.
  Future<void> _refreshPreview({String? promoCode}) async {
    if (_selectedAddress == null) return;
    if (_isFormulaPricing && !_pricingFieldsComplete) return;
    final generation = ++_previewRequestGeneration;
    setState(() => _previewLoading = true);
    try {
      final result = await _repository.previewPrice(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        bookingMode: widget.bookingMode,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        addonIds: _selectedAddonIds.toList(),
        promoCode: promoCode,
      );
      if (mounted && generation == _previewRequestGeneration) setState(() => _pricePreview = result);
    } on ApiException catch (err) {
      if (mounted && generation == _previewRequestGeneration) setState(() => _previewError = err.message);
    } finally {
      if (mounted && generation == _previewRequestGeneration) setState(() => _previewLoading = false);
    }
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
        // العنوان اتغيّر — أي معاينة سعر/خصم قديمة بقت مش موثوقة (النطاق ممكن يختلف).
        _pricePreview = null;
        _promoError = null;
      });
      _refreshPreview();
    }
  }

  Future<void> _validatePromo() async {
    final code = _promoController.text.trim();
    if (code.isEmpty) return;
    if (_selectedAddress == null) {
      setState(() => _promoError = 'اختار عنوان الأول');
      return;
    }
    if (_isFormulaPricing && !_pricingFieldsComplete) {
      setState(() => _promoError = 'كمّل بيانات السعر الأول');
      return;
    }
    setState(() {
      _validatingPromo = true;
      _promoError = null;
    });
    final generation = ++_previewRequestGeneration;
    try {
      final result = await _repository.previewPrice(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        bookingMode: widget.bookingMode,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        addonIds: _selectedAddonIds.toList(),
        promoCode: code,
      );
      // فشل التحقق بيسيب آخر معاينة صح (من غير خصم) ظاهرة، مش بيمسحها — العميل يشوف
      // "الكود ده مش موجود" جنب حقل الكود، مش رقم فاضي بدل السعر الصحيح.
      if (mounted && generation == _previewRequestGeneration) setState(() => _pricePreview = result);
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
    if (_isFormulaPricing) {
      if (_hasUnsupportedRequiredField) {
        setState(() => _error = 'الخدمة دي محتاجة تفاصيل (صور/موقع) مش مدعومة في التطبيق لسه — كلم الدعم لإتمام الحجز');
        return;
      }
      if (!_pricingFieldsComplete) {
        setState(() => _error = 'كمّل كل بيانات السعر المطلوبة الأول');
        return;
      }
    }
    // لازم نعرض السعر الحقيقي الكامل قبل ما نسمح بالتأكيد لأي نموذج تسعير — مفيش تأكيد "أعمى"
    // (docs/08 §2، طلب صريح: نفس المدخلات اللي هتتبعت لازم تتعرض قبل التأكيد بالظبط).
    if (_pricePreview == null) {
      setState(() => _error = 'استنى لحد ما السعر يتحسب');
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
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        scheduleSlotId: widget.scheduleSlotId,
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

  Widget _buildPriceLine(String label, String value, {bool bold = false, Color? color}) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.bold : FontWeight.normal,
      color: color,
      fontSize: bold ? 16 : 14,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(label, style: style), Text(value, style: style)],
      ),
    );
  }

  // تفصيل السعر الكامل قبل التأكيد (docs/08 §1/§2، طلب صريح من المالك: "breakdown واضح مش رقم
  // واحد غامض"). نفس البنود بالحرف اللي POST /orders هيحسبها فعليًا لو اتبعتت نفس المدخلات.
  Widget _buildPriceBreakdown() {
    if (_selectedAddress == null) {
      return const Text('اختار عنوان الأول عشان نعرضلك السعر الحقيقي (السعر بيختلف حسب المنطقة)');
    }
    if (_isFormulaPricing && !_pricingFieldsComplete) {
      return const Text('كمّل بيانات السعر تحت عشان نحسبلك السعر');
    }
    if (_previewLoading && _pricePreview == null) {
      return const Row(
        children: [
          SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 8),
          Text('بيتحسب السعر...'),
        ],
      );
    }
    if (_previewError != null && _pricePreview == null) {
      return Text(_previewError!, style: const TextStyle(color: Colors.red));
    }
    final preview = _pricePreview;
    if (preview == null) return const Text('كمّل بيانات الحجز عشان نعرضلك السعر');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildPriceLine('السعر الأساسي', _formatEgp(preview.basePriceCents)),
        if (preview.minPriceCents != null && preview.maxPriceCents != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              'نطاق تقديري: ${_formatEgp(preview.minPriceCents!)} – ${_formatEgp(preview.maxPriceCents!)}',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ),
        if (preview.inspectionFeeCents > 0) _buildPriceLine('رسوم الفحص', _formatEgp(preview.inspectionFeeCents)),
        if (preview.emergencySurchargeCents > 0)
          _buildPriceLine('رسوم الطوارئ', '+${_formatEgp(preview.emergencySurchargeCents)}', color: Colors.orange),
        if (preview.emergencySlaMinutes != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('هيوصلك خلال ${preview.emergencySlaMinutes} دقيقة تقريبًا', style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ),
        if (preview.addonsTotalCents > 0) _buildPriceLine('الإضافات', '+${_formatEgp(preview.addonsTotalCents)}'),
        if (preview.discountCents > 0) _buildPriceLine('الخصم', '-${_formatEgp(preview.discountCents)}', color: Colors.green),
        if (preview.estimatedDurationDays != null)
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 4),
            child: Text(
              'المدة المتوقعة: ${preview.estimatedDurationDays! % 1 == 0 ? preview.estimatedDurationDays!.toStringAsFixed(0) : preview.estimatedDurationDays!.toStringAsFixed(1)} يوم',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ),
        const Divider(height: 12),
        _buildPriceLine('الإجمالي', _formatEgp(preview.totalAmountCents), bold: true),
        if (_previewLoading)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('بيتحدّث...', style: TextStyle(fontSize: 11, color: Colors.grey)),
          ),
      ],
    );
  }

  // محرك الإنتاجية (docs/06 §3.1-§3.6) — كانت فجوة موثّقة صراحة. مفيش شرط إجباري (خدمات كتير
  // مالهاش service_standard_data خالص) — القايمة فاضية يعني الخدمة دي مش مفعّل ليها الإنتاجية،
  // فالقسم كله بيختفي بهدوء من غير أي رسالة خطأ.
  List<Widget> _buildStandardDataSection() {
    if (_standardDataRows.isEmpty) return const [];
    return [
      const SizedBox(height: 16),
      Text('المدة المتوقعة (اختياري)', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_standardDataRows.length > 1)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: DropdownButtonFormField<ServiceStandardDataRow>(
                    initialValue: _selectedStandardData,
                    decoration: const InputDecoration(labelText: 'نوع التنفيذ', border: OutlineInputBorder()),
                    items: _standardDataRows
                        .map((row) => DropdownMenuItem(value: row, child: Text(row.executionTypeAr)))
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedStandardData = value;
                        _durationEstimate = null;
                        _durationError = null;
                      });
                      if (_requestedUnitsController.text.trim().isNotEmpty) _refreshDurationEstimate();
                    },
                  ),
                ),
              TextField(
                controller: _requestedUnitsController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'الكمية (${_selectedStandardData?.unitAr ?? ''})',
                  border: const OutlineInputBorder(),
                ),
                onChanged: _onRequestedUnitsChanged,
              ),
              if (_estimatingDuration) ...[
                const SizedBox(height: 8),
                const Text('بيتحسب...', style: TextStyle(fontSize: 12, color: Colors.grey)),
              ] else if (_durationError != null) ...[
                const SizedBox(height: 8),
                Text(_durationError!, style: const TextStyle(color: Colors.red, fontSize: 12)),
              ] else if (_durationEstimate != null) ...[
                const SizedBox(height: 8),
                Text(
                  'المدة المتوقعة: ${_durationEstimate!.estimatedDays} يوم (${_durationEstimate!.executionTypeAr})',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ],
          ),
        ),
      ),
    ];
  }

  List<Widget> _buildPricingFieldsSection() {
    if (_loadingPricingFields) {
      return const [
        SizedBox(height: 16),
        Center(child: CircularProgressIndicator()),
      ];
    }
    if (_pricingFieldsError != null) {
      return [
        const SizedBox(height: 16),
        Text(_pricingFieldsError!, style: const TextStyle(color: Colors.red)),
      ];
    }
    final sortedFields = [..._pricingFields]..sort((a, b) => a.fieldKey.compareTo(b.fieldKey));
    return [
      const SizedBox(height: 16),
      Text('تفاصيل تحديد السعر', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: sortedFields.map(_buildPricingFieldWidget).toList(),
          ),
        ),
      ),
    ];
  }

  Widget _buildPricingFieldWidget(PricingField field) {
    // أنواع الحقول اللي لسه مش مدعومة (location/image_upload/video_upload/voice_note) —
    // راجع الملحوظة في catalog/models.dart. لو مطلوب، بنمنع الإرسال في _submit()، وهنا بس
    // بنوضّح للعميل ليه الحقل ده مش ظاهر كمدخل فعلي.
    if (!field.isSupported) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(
          field.isRequired
              ? '⚠️ "${field.labelAr}" محتاج تفاصيل (صورة/موقع) مش مدعومة في التطبيق لسه'
              : '"${field.labelAr}" اختياري ومش مدعوم في التطبيق حاليًا — هيتجاهل',
          style: TextStyle(color: field.isRequired ? Colors.red : Colors.grey),
        ),
      );
    }

    final label = field.unitAr != null ? '${field.labelAr} (${field.unitAr})' : field.labelAr;

    switch (field.fieldType) {
      case 'number':
      case 'area':
      case 'length':
      case 'volume':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: TextFormField(
            decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (value) {
              final parsed = num.tryParse(value);
              _onFieldValueChanged(field.fieldKey, parsed);
            },
          ),
        );

      case 'dropdown':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: DropdownButtonFormField<String>(
            decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
            initialValue: _fieldValues[field.fieldKey] as String?,
            items: (field.options ?? [])
                .map((o) => DropdownMenuItem(value: o.value, child: Text(o.labelAr)))
                .toList(),
            onChanged: (value) => _onFieldValueChanged(field.fieldKey, value),
          ),
        );

      case 'multi_select':
        final selected = (_fieldValues[field.fieldKey] as List<String>?) ?? <String>[];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodyMedium),
              Wrap(
                spacing: 8,
                children: (field.options ?? [])
                    .map(
                      (o) => FilterChip(
                        label: Text(o.labelAr),
                        selected: selected.contains(o.value),
                        onSelected: (isSelected) {
                          final updated = [...selected];
                          if (isSelected) {
                            updated.add(o.value);
                          } else {
                            updated.remove(o.value);
                          }
                          _onFieldValueChanged(field.fieldKey, updated.isEmpty ? null : updated);
                        },
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        );

      case 'checkbox':
        return SwitchListTile(
          title: Text(label),
          value: (_fieldValues[field.fieldKey] as bool?) ?? false,
          onChanged: (value) => _onFieldValueChanged(field.fieldKey, value),
        );

      case 'slider':
        final min = (field.minValue ?? 0).toDouble();
        final effectiveMax = (field.maxValue ?? 100).toDouble();
        final max = effectiveMax > min ? effectiveMax : min + 1;
        final current = ((_fieldValues[field.fieldKey] as num?)?.toDouble() ?? min).clamp(min, max).toDouble();
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$label: ${current.toStringAsFixed(0)}'),
              Slider(
                min: min,
                max: max,
                value: current,
                onChanged: (value) => _onFieldValueChanged(field.fieldKey, value),
              ),
            ],
          ),
        );

      case 'date':
        final currentValue = _fieldValues[field.fieldKey] as String?;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4), side: BorderSide(color: Theme.of(context).dividerColor)),
            title: Text(label),
            subtitle: Text(currentValue ?? 'اختار تاريخ'),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.now(),
                firstDate: DateTime.now().subtract(const Duration(days: 365)),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) {
                final formatted = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                _onFieldValueChanged(field.fieldKey, formatted);
              }
            },
          ),
        );

      case 'time':
        final currentValue = _fieldValues[field.fieldKey] as String?;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: ListTile(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4), side: BorderSide(color: Theme.of(context).dividerColor)),
            title: Text(label),
            subtitle: Text(currentValue ?? 'اختار وقت'),
            onTap: () async {
              final picked = await showTimePicker(context: context, initialTime: TimeOfDay.now());
              if (picked != null) {
                final formatted = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
                _onFieldValueChanged(field.fieldKey, formatted);
              }
            },
          ),
        );

      default:
        // نوع مش متوقع (enum جديد اتضاف في الباك-إند ومحدّش حدّث الفرونت) — نفس معاملة
        // الأنواع الغير مدعومة (isSupported=false)، عشان مانضربش خطأ غير واضح للعميل.
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            field.isRequired ? '⚠️ "${field.labelAr}" نوع حقل مش معروف — كلم الدعم' : '"${field.labelAr}" نوع حقل مش مدعوم، هيتجاهل',
            style: TextStyle(color: field.isRequired ? Colors.red : Colors.grey),
          ),
        );
    }
  }

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
              child: ListTile(title: Text(widget.service.nameAr)),
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
            if (widget.scheduleSlotId != null) ...[
              const SizedBox(height: 16),
              Card(
                color: Theme.of(context).colorScheme.primaryContainer,
                child: const ListTile(
                  leading: Icon(Icons.event_available_outlined),
                  title: Text('حجز موعد محدد مع هذا الفني'),
                  subtitle: Text('الطلب هيتوزّع على الفني ده أول حاجة — لو مش متاح وقتها، هنلاقيلك فني تاني'),
                ),
              ),
            ],
            if (_isFormulaPricing) ..._buildPricingFieldsSection() else ..._buildStandardDataSection(),
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
                          onChanged: (checked) {
                            setState(() {
                              if (checked == true) {
                                _selectedAddonIds.add(addon.id);
                              } else {
                                _selectedAddonIds.remove(addon.id);
                              }
                              _pricePreview = null;
                            });
                            _refreshPreview();
                          },
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
                    // بَقّة حقيقية اتلقطت (مراجعة booking flow الشاملة 2026-08-12): لو العميل
                    // عدّل نص الكود بعد ما اتحقق منه، السعر المعروض كان يفضل من الكود القديم —
                    // ده بيمسح الخصم فورًا (بمعاينة تانية من غير كود) لحد ما يضغط "تحقق" تاني،
                    // عشان السعر المعروض دايمًا يطابق الكود اللي فعلاً هيتبعت وقت التأكيد.
                    onChanged: (_) {
                      setState(() {
                        _promoError = null;
                        _pricePreview = null;
                      });
                      _refreshPreview();
                    },
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
            const SizedBox(height: 16),
            Text('ملخص السعر', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: _buildPriceBreakdown(),
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
