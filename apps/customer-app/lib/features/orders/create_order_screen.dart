import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart';
import '../catalog/pricing_field_widgets.dart';
import '../payments/card_payment_screen.dart';
import '../payments/instapay_reference_screen.dart';
import '../payments/payments_repository.dart';
import '../support/support_contact_screen.dart';
import 'models.dart';
import 'order_detail_screen.dart';
import 'orders_repository.dart';
import 'schedule_selection_screen.dart';

class CreateOrderScreen extends StatefulWidget {
  final CatalogService service;
  final BookingMode bookingMode;
  final String? requestedTechnicianId;
  // توحيد فلو "اعتماد" مع "فردي" (docs/08 §38) — اختيار الشركة بقى بيحصل فوق في
  // TechnicianMarketplaceScreen (كارت موحّد مع الفنيين الأفراد)، مش هنا (الـRadioListTile
  // القديم اتشال — كان مفروض على العميل يوصل لآخر الشاشة الأولى عشان يختار شركة).
  final String? requestedTechnicianCompanyId;
  // الجدولة الحقيقية للفني (docs/08 §2-§3) — العميل اختار سلوت محدد من TechnicianProfileScreen.
  // requestedTechnicianId مش لازم يتبعت معاها (الباك-إند بيستنتجه من السلوت نفسه)، بس لو اتبعت
  // برضه لازم تكون بتاعة نفس فني السلوت وإلا الطلب هيترفض بوضوح.
  final String? scheduleSlotId;
  // اختيار الفني قبل الحجز (docs/08 §3) — TechnicianSelectionScreen بتخلي العميل يختار عنوان
  // الأول عشان تجيبله قايمة الفنيين (GET /services/:id/technicians محتاج address_id)؛ بنمررها
  // هنا عشان العميل ميضطرش يختارها تاني هنا — تجربة استخدام أسوأ لو كررناها.
  final Address? initialAddress;
  // P0-10 (2026-08-13) — لخدمات pricing_model=formula، JobDetailsScreen بتجمع field_values
  // *قبل* شاشة اختيار الفني (عشان قايمة الفنيين تقدر تعرض السعر النهائي الحقيقي لكل واحد). لما
  // العميل يوصل هنا بعد ما اختار فني من القايمة دي، القيم دي بتتمرر جاهزة عشان مايدخلش نفس
  // البيانات مرتين — لسه ظاهرة ومعدّلة هنا (مش قراءة فقط) لو حاب يغيّر حاجة قبل التأكيد النهائي.
  final Map<String, dynamic>? initialFieldValues;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — اتحددت إجباريًا في بداية التدفق (catalog_navigation.dart)
  // لكل وضع غير الطوارئ. Widget النهائي هنا بيعرضها ويسمح بتغييرها قبل التأكيد النهائي (نفس فلسفة
  // "تغيير العنوان"). null بس في وضع الطوارئ.
  final DateTime? requestedAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3، طلب مالك صريح 2026-08-20) — لو موجودة، الباك-إند
  // بيختار أقرب يوم فعليًا متاح جوّه [requestedAt, requestedAtRangeEnd] بدل requestedAt الحرفي.
  // بتتصفّر تلقائيًا لو العميل غيّر الموعد من هنا (نفس فلسفة _pickSchedule تحت).
  final DateTime? requestedAtRangeEnd;

  const CreateOrderScreen({
    super.key,
    required this.service,
    required this.bookingMode,
    this.requestedTechnicianId,
    this.requestedTechnicianCompanyId,
    this.scheduleSlotId,
    this.initialAddress,
    this.initialFieldValues,
    this.requestedAt,
    this.requestedAtRangeEnd,
  });

  @override
  State<CreateOrderScreen> createState() => _CreateOrderScreenState();
}

class _CreateOrderScreenState extends State<CreateOrderScreen> {
  late final OrdersRepository _repository;
  late final PaymentsRepository _paymentsRepository;
  // دفع قبل التوزيع (ADR-0013، docs/08 §19 بند 1) — null = الافتراضي القديم (دفع بعد الشغل).
  // 'card'/'instapay' بس مدعومين هنا (نفس قيد CreateOrderDto.payment_method في الباك-إند —
  // كاش/محفظة مالهمش معنى "قبل" التوزيع، دفعهم بيحصل بعد الشغل زي ما هو دايمًا).
  String? _selectedPaymentMethod;
  final _catalogRepository = CatalogRepository();
  final _descriptionController = TextEditingController();
  final _promoController = TextEditingController();
  final _buildingController = TextEditingController();
  Address? _selectedAddress;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — قابلة للتغيير هنا برضه (نفس _selectedAddress)،
  // مش مقفولة على اختيار الشاشة السابقة.
  late DateTime? _requestedAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3) — بتتصفّر لو العميل غيّر الموعد من هنا (_pickSchedule).
  late DateTime? _requestedAtRangeEnd;
  bool _submitting = false;
  // Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — بيتولّد مرة واحدة بس
  // وقت فتح الشاشة (نفس درس generateIdempotencyKey() في payments_repository.dart بالحرف: توليد
  // مفتاح جديد جوّه _submit() نفسها كان هيلغي الحماية لأي retry). أي محاولة تانية من نفس الشاشة
  // (double-tap، إعادة إرسال بعد timeout شبكة) بتستخدم نفس المفتاح.
  late final String _orderIdempotencyKey;
  bool _validatingPromo = false;
  String? _promoError;
  bool _validatingBuilding = false;
  String? _buildingError;
  String? _error;
  List<ServiceAddon> _addons = [];
  final Set<String> _selectedAddonIds = {};

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

  // دقة الوقت (ADR-0031 Slice B) — service.requiresPreciseSchedule=true محتاجة وقت بداية دقيق
  // (مش يوم بس، ADR-0018) + مدة بالساعات. TimeOfDay منفصل عن _requestedAt (اللي بيحمل اليوم بس
  // من ScheduleSelectionScreen)، بيتدمجوا مع بعض وقت الإرسال (_combinedPreciseScheduledAt).
  TimeOfDay? _preciseTime;
  final _durationHoursController = TextEditingController();
  DurationEstimate? _durationEstimate;
  bool _estimatingDuration = false;
  String? _durationError;
  Timer? _durationDebounce;

  // Script 2 Part I (findings #46/#47/#48) — فاضية لحد ما /payment-channels يرد؛ زرار "ادفع بعد
  // الخدمة" (value: null) دايمًا ظاهر بغض النظر عن القيمة دي لأنه مش بيعتمد على أي provider خارجي.
  Set<String> _availablePaymentMethods = {};

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _paymentsRepository = PaymentsRepository(context.read<AuthRepository>());
    _orderIdempotencyKey = _paymentsRepository.generateIdempotencyKey();
    _selectedAddress = widget.initialAddress;
    _requestedAt = widget.requestedAt;
    _requestedAtRangeEnd = widget.requestedAtRangeEnd;
    if (widget.initialFieldValues != null) _fieldValues.addAll(widget.initialFieldValues!);
    _loadAddons();
    if (_isFormulaPricing) {
      _loadPricingFields();
    } else {
      _loadStandardData();
    }
    if (_selectedAddress != null) _refreshPreview();
    _loadAvailablePaymentMethods();
  }

  // فشل الجلب هنا مش خطير — بيسيب _availablePaymentMethods فاضية، يعني خياري الدفع الإلكتروني
  // مش هيظهروا (بدل ما يظهروا ويترفضوا لاحقًا)، و"ادفع بعد الخدمة" يفضل شغال عادي دايمًا.
  Future<void> _loadAvailablePaymentMethods() async {
    try {
      final methods = await _repository.fetchAvailablePaymentMethods();
      if (!mounted) return;
      setState(() {
        _availablePaymentMethods = methods;
        // نادرة (نفس finding #48: البوابة اتقفلت والعميل الشاشة فاتحة قدامه) — نرجّع افتراضي آمن.
        if (_selectedPaymentMethod != null && !methods.contains(_selectedPaymentMethod)) {
          _selectedPaymentMethod = null;
        }
      });
    } catch (_) {
      // صامت عمدًا — نفس فلسفة كل مكان تاني في المشروع: فشل خدمة/endpoint ثانوي ميوقفش الشاشة.
    }
  }

  @override
  void dispose() {
    _priceDebounce?.cancel();
    _durationDebounce?.cancel();
    _requestedUnitsController.dispose();
    _durationHoursController.dispose();
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
      if (mounted) {
        setState(() {
          _pricingFields = fields;
          // بَقّة حقيقية اتلقطت (مراجعة مالك مباشرة): SwitchListTile بتاعة حقل checkbox بترسم
          // "متفعّلش" افتراضيًا (`?? false`) من غير ما القيمة دي تتحط في _fieldValues فعليًا —
          // لو الحقل مطلوب، الغياب ده بيخلي _pricingFieldsComplete/الباك-إند يرفضوا "الحقل مطلوب"
          // لحد ما العميل يلمس السويتش مرة (حتى لو رجع سيبه false تاني بعد كده بيشتغل عادي).
          // الإصلاح: نفس الافتراض الضمني اللي الباك-إند بيطبّقه (resolveDefaultValue في
          // pricing-engine.service.ts) — false صريحة من أول ما الفورم يتحمّل، مش لما العميل يدوس.
          for (final field in fields) {
            if (field.fieldType == 'checkbox' && !_fieldValues.containsKey(field.fieldKey)) {
              _fieldValues[field.fieldKey] = false;
            }
          }
        });
      }
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
  Future<void> _refreshPreview({String? promoCode, String? buildingCode}) async {
    if (_selectedAddress == null) return;
    if (_isFormulaPricing && !_pricingFieldsComplete) return;
    final generation = ++_previewRequestGeneration;
    setState(() => _previewLoading = true);
    try {
      final result = await _repository.previewPrice(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        bookingMode: widget.bookingMode,
        requestedTechnicianId: widget.requestedTechnicianId,
        scheduleSlotId: widget.scheduleSlotId,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        addonIds: _selectedAddonIds.toList(),
        promoCode: promoCode,
        buildingCode: buildingCode,
      );
      if (mounted && generation == _previewRequestGeneration) setState(() => _pricePreview = result);
    } on ApiException catch (err) {
      if (mounted && generation == _previewRequestGeneration) setState(() => _previewError = err.message);
    } finally {
      if (mounted && generation == _previewRequestGeneration) setState(() => _previewLoading = false);
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
        _buildingError = null;
      });
      _refreshPreview();
    }
  }

  // "تغيير الموعد" (docs/08 §154) — بلا أثر لو الطلب مربوط بسلوت جدولة محدد (widget.scheduleSlotId)،
  // ده موعد الفني نفسه المعلن، مش موعد حر قابل للتعديل من هنا.
  Future<void> _pickSchedule() async {
    final choice = await Navigator.of(context).push<ScheduleChoice>(
      MaterialPageRoute(
        builder: (_) => ScheduleSelectionScreen(allowsDateRangeBooking: widget.service.allowsDateRangeBooking),
      ),
    );
    if (choice != null && mounted) {
      setState(() {
        _requestedAt = choice.scheduledAt;
        _requestedAtRangeEnd = choice.rangeEnd;
      });
    }
  }

  // دقة الوقت (ADR-0031 Slice B) — بيدمج اليوم المختار من ScheduleSelectionScreen (_requestedAt)
  // مع الساعة المختارة هنا (_preciseTime) في وقت UTC واحد يتبعت في scheduled_at بدل اليوم المجرّد.
  DateTime? _combinedPreciseScheduledAt() {
    final day = _requestedAt;
    final time = _preciseTime;
    if (day == null || time == null) return null;
    return DateTime(day.year, day.month, day.day, time.hour, time.minute);
  }

  Future<void> _pickPreciseTime() async {
    final picked = await showTimePicker(context: context, initialTime: _preciseTime ?? const TimeOfDay(hour: 10, minute: 0));
    if (picked != null && mounted) setState(() => _preciseTime = picked);
  }

  // يوم بس، بلا ساعة (ADR-0018 §2 — العميل بيختار اليوم، مش وقت محدد). null بس في وضع الطوارئ
  // (الصف ده مش ظاهر أصلاً وقتها — راجع _buildScheduleRow تحت).
  String _formatRequestedAt() {
    final at = _requestedAt;
    if (at == null) return 'فوري';
    final rangeEnd = _requestedAtRangeEnd;
    if (rangeEnd != null) {
      final two = (int n) => n.toString().padLeft(2, '0');
      return 'مرن: ${two(at.day)}/${two(at.month)} — ${two(rangeEnd.day)}/${two(rangeEnd.month)}';
    }
    final today = DateTime.now();
    final isToday = at.year == today.year && at.month == today.month && at.day == today.day;
    final tomorrow = today.add(const Duration(days: 1));
    final isTomorrow = at.year == tomorrow.year && at.month == tomorrow.month && at.day == tomorrow.day;
    if (isToday) return 'النهاردة';
    if (isTomorrow) return 'بكرة';
    final two = (int n) => n.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)}/${at.year}';
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
      _buildingController.clear();
      _buildingError = null;
    });
    final generation = ++_previewRequestGeneration;
    try {
      final result = await _repository.previewPrice(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        bookingMode: widget.bookingMode,
        requestedTechnicianId: widget.requestedTechnicianId,
        scheduleSlotId: widget.scheduleSlotId,
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

  // نظام العمائر (docs/08 §13, ADR-0003) — كانت فجوة موثّقة صراحة: الباك-إند بيدعم building_code
  // بديل لـpromo_code في POST /orders و/orders/preview بالظبط من زمان (خصم تلقائي حسب اشتراك
  // العمارة)، بس مفيش حقل في الشاشة كان بيستخدمه خالص. نفس منطق _validatePromo بالحرف — الاتنين
  // مش مسموح يتبعتوا مع بعض (الباك-إند بيرفض)، فمسح الكود التاني عند تفعيل واحد بدل ما نسيب
  // العميل يكتشف الرفض بعد التأكيد.
  Future<void> _validateBuilding() async {
    final code = _buildingController.text.trim();
    if (code.isEmpty) return;
    if (_selectedAddress == null) {
      setState(() => _buildingError = 'اختار عنوان الأول');
      return;
    }
    if (_isFormulaPricing && !_pricingFieldsComplete) {
      setState(() => _buildingError = 'كمّل بيانات السعر الأول');
      return;
    }
    setState(() {
      _validatingBuilding = true;
      _buildingError = null;
      _promoController.clear();
      _promoError = null;
    });
    final generation = ++_previewRequestGeneration;
    try {
      final result = await _repository.previewPrice(
        serviceId: widget.service.id,
        addressId: _selectedAddress!.id,
        bookingMode: widget.bookingMode,
        requestedTechnicianId: widget.requestedTechnicianId,
        scheduleSlotId: widget.scheduleSlotId,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        addonIds: _selectedAddonIds.toList(),
        buildingCode: code,
      );
      if (mounted && generation == _previewRequestGeneration) setState(() => _pricePreview = result);
    } on ApiException catch (err) {
      if (mounted) setState(() => _buildingError = err.message);
    } finally {
      if (mounted) setState(() => _validatingBuilding = false);
    }
  }

  // دفع قبل التوزيع (docs/08 §19 بند 1) — بيفتح نفس شاشات الدفع المستخدمة أصلاً للدفع بعد
  // الشغل (CardPaymentScreen/InstaPayReferenceScreen، order_detail_screen.dart) — صفر شاشة دفع
  // جديدة مختلفة، نفس تجربة "افتح البوابة، أكّد، استنى" بالظبط.
  Future<void> _startPrepayment(String orderId, String method) async {
    try {
      final idempotencyKey = _paymentsRepository.generateIdempotencyKey();
      if (method == 'card') {
        final redirectUrl = await _paymentsRepository.payWithCard(orderId, idempotencyKey);
        if (!mounted) return;
        await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => CardPaymentScreen(orderId: orderId, redirectUrl: redirectUrl)),
        );
      } else if (method == 'instapay') {
        final reference = await _paymentsRepository.payWithInstaPay(orderId, idempotencyKey);
        if (!mounted) return;
        await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => InstaPayReferenceScreen(orderId: orderId, reference: reference)),
        );
      }
    } on ApiException catch (err) {
      // مش هيمنع الانتقال لـOrderDetailScreen — العميل يقدر يعيد المحاولة من هناك لو الأزرار
      // موجودة، أو الطلب هيتلغى تلقائيًا لو ماكملش خلال المهلة (راجع تعليق _submit فوق).
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
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
        requestedTechnicianId: widget.requestedTechnicianId,
        scheduleSlotId: widget.scheduleSlotId,
        // السلوت (لو موجود) بيغلب الموعد الحر عند الباك-إند بالفعل — بس نتجنّب تعارض ظاهري
        // بينهم لو العميل غيّر الموعد هنا بعد ما اختار سلوت فني بعينه.
        scheduledAt: widget.scheduleSlotId == null
            ? (widget.service.requiresPreciseSchedule
                    ? _combinedPreciseScheduledAt()
                    : _requestedAt)
                ?.toUtc()
                .toIso8601String()
            : null,
        // "مرن — اختار نطاق أيام" (docs/08 §32.3) — بتتجاهل بأمان لو فيه سلوت محدد (نفس منطق
        // scheduledAt فوق بالحرف).
        scheduledAtRangeEnd:
            widget.scheduleSlotId == null ? _requestedAtRangeEnd?.toUtc().toIso8601String() : null,
        durationHours: widget.service.requiresPreciseSchedule ? int.tryParse(_durationHoursController.text.trim()) : null,
        problemDescription: _descriptionController.text.trim(),
        promoCode: _promoController.text.trim(),
        buildingCode: _buildingController.text.trim(),
        addonIds: _selectedAddonIds.toList(),
        requestedTechnicianCompanyId: widget.requestedTechnicianCompanyId,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        standardDataId: _selectedStandardData?.id,
        requestedUnits: num.tryParse(_requestedUnitsController.text.trim()),
        paymentMethod: _selectedPaymentMethod,
        idempotencyKey: _orderIdempotencyKey,
      );
      // دفع قبل التوزيع (docs/08 §19 بند 1) — الطلب رجع pending_payment، لازم نوجّه العميل
      // لشاشة الدفع فورًا (مش نسيبه يكتشف بنفسه) — التوزيع مش هيبدأ غير بعد ما الدفع يتأكد.
      // فشل/إلغاء العميل لشاشة الدفع هنا مش نهاية العالم: الطلب فضل pending_payment،
      // sweepPendingPayment() في الباك-إند هيلغيه تلقائيًا لو العميل ماكملش خلال المهلة
      // (orders.payment_timeout_minutes) — مفيش طلب معلّق للأبد.
      if (order.orderStatus == 'pending_payment' && _selectedPaymentMethod != null) {
        await _startPrepayment(order.id, _selectedPaymentMethod!);
      }
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
              // مساعدة حجز بسيطة (docs/08 §22 addendum) — العميل ممكن مايعرفش يقيس الكمية دي
              // (مساحة/عدد قطع إلخ)، مفيش محرك تسعير تاني هنا، بس مخرج بسيط لمكالمة/واتساب.
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const SupportContactScreen()),
                  ),
                  icon: const Icon(Icons.help_outline, size: 18),
                  label: const Text('مش عارف تقيس؟ كلّمنا نساعدك'),
                ),
              ),
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

  // منطق رسم الحقول اتقلع لملف مشترك (catalog/pricing_field_widgets.dart) — P0-10 (2026-08-13):
  // JobDetailsScreen محتاجة نفس الرسم قبل شاشة اختيار الفني، فمفيش داعي نكرره هنا.
  Widget _buildPricingFieldWidget(PricingField field) =>
      buildPricingFieldWidget(context, field, _fieldValues, _onFieldValueChanged);

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
            ] else if (widget.bookingMode != BookingMode.emergency) ...[
              const SizedBox(height: 16),
              Text('الموعد المطلوب', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: ListTile(
                  leading: Icon(_requestedAtRangeEnd != null ? Icons.event_repeat_outlined : Icons.event_outlined),
                  title: Text(_formatRequestedAt()),
                  trailing: const Icon(Icons.chevron_left),
                  onTap: _pickSchedule,
                ),
              ),
              // دقة الوقت (ADR-0031 Slice B) — خدمات زي جليسة الأطفال/التنظيف بالساعة محتاجة
              // وقت بداية دقيق + مدة، مش يوم كامل بس.
              if (widget.service.requiresPreciseSchedule) ...[
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.schedule_outlined),
                    title: Text(_preciseTime != null ? 'الساعة ${_preciseTime!.format(context)}' : 'حدد وقت البداية'),
                    trailing: const Icon(Icons.chevron_left),
                    onTap: _pickPreciseTime,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _durationHoursController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'عدد الساعات المطلوبة', border: OutlineInputBorder()),
                ),
              ],
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
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _buildingController,
                    decoration: const InputDecoration(
                      labelText: 'كود عمارة (اختياري — خصم بدل كود الخصم)',
                      border: OutlineInputBorder(),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    onChanged: (_) {
                      setState(() {
                        _buildingError = null;
                        _pricePreview = null;
                      });
                      _refreshPreview();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _validatingBuilding ? null : _validateBuilding,
                  child: _validatingBuilding
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('تحقق'),
                ),
              ],
            ),
            if (_buildingError != null) ...[
              const SizedBox(height: 4),
              Text(_buildingError!, style: const TextStyle(color: Colors.red)),
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
            Text('طريقة الدفع', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: Column(
                children: [
                  RadioListTile<String?>(
                    value: null,
                    groupValue: _selectedPaymentMethod,
                    onChanged: (value) => setState(() => _selectedPaymentMethod = value),
                    title: const Text('ادفع بعد الخدمة (زي العادة)'),
                    subtitle: const Text('كاش أو من المحفظة بعد ما الفني يخلّص الشغل'),
                  ),
                  if (_availablePaymentMethods.contains('card'))
                    RadioListTile<String?>(
                      value: 'card',
                      groupValue: _selectedPaymentMethod,
                      onChanged: (value) => setState(() => _selectedPaymentMethod = value),
                      title: const Text('ادفع الآن بالبطاقة أو محفظة إلكترونية'),
                      subtitle: const Text('يبدأ البحث عن فني فورًا بعد ما الدفع يتأكّد'),
                    ),
                  if (_availablePaymentMethods.contains('instapay'))
                    RadioListTile<String?>(
                      value: 'instapay',
                      groupValue: _selectedPaymentMethod,
                      onChanged: (value) => setState(() => _selectedPaymentMethod = value),
                      title: const Text('ادفع الآن بـ InstaPay'),
                      subtitle: const Text('تحويل بكود مرجعي، تأكيد الفريق قد ياخد وقت أطول'),
                    ),
                ],
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
