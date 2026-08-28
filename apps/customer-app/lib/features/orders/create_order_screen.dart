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
import '../payments/fawry_reference_screen.dart';
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
  // دقة الوقت (docs/08 §84 جزء ج) — مليانين مسبقًا لو العميل اختارهم أصلاً في
  // ScheduleSelectionScreen (requiresPreciseSchedule/requiresStartTimeOnly). لسه قابلين للتعديل
  // هنا (_pickPreciseTime/_durationHoursController)، نفس فلسفة requestedAt فوق بالحرف.
  final TimeOfDay? requestedPreciseTime;
  final int? requestedDurationHours;

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
    this.requestedPreciseTime,
    this.requestedDurationHours,
  });

  @override
  State<CreateOrderScreen> createState() => _CreateOrderScreenState();
}

class _CreateOrderScreenState extends State<CreateOrderScreen> {
  late final OrdersRepository _repository;
  late final PaymentsRepository _paymentsRepository;
  // دفع قبل التوزيع (ADR-0013، docs/08 §19 بند 1) — null = الافتراضي القديم (دفع بعد الشغل).
  // card/instapay/fawry_reference دفع مسبق. installment اختيار تجهيز طلب التقسيط بعد إنشاء الطلب.
  // كاش/محفظة مالهمش معنى "قبل" التوزيع، دفعهم بيحصل بعد الشغل زي ما هو دايمًا).
  String? _selectedPaymentMethod;
  final _catalogRepository = CatalogRepository();
  final _descriptionController = TextEditingController();
  /// **حقل كود واحد بدل اتنين (docs/08 §77-B4، طلب مالك صريح)**: «موجود مكانين تدخل فيهم
  /// أكواد… ملهاش لازمة خالص يبقوا اتنين، هو واحد كفاية وندمج فيه الاتنين».
  ///
  /// والدمج ده مش تبسيط بصري بس — هو **التمثيل الصح للسلوك الحقيقي**: الباك-إند بيرفض إرسال
  /// `promo_code` و`building_code` مع بعض أصلاً، والكود القديم كان بيمسح واحد لما التاني
  /// يتفعّل. يعني هما حصريان متبادلان بالتصميم، وعرضهم كحقلين كان بيكشف تعقيد داخلي للعميل
  /// بلا أي فايدة له — هو أصلاً بيمسك ورقة عليها كود واحد، ومش عارف ولا مهتم بنوعه.
  final _codeController = TextEditingController();

  /// **مفاتيح الأقسام للتمرير التلقائي (docs/08 §77-B5)**.
  ///
  /// طلب المالك: «دايمًا بجي تحت عشان أبتدي أحسب الحساب، يقولي الساعة ناقصة… يعني مثلًا يحصل
  /// scrolling أوتوماتيك على الحاجة الناقصة». والملاحظة دقيقة: الشاشة طويلة، ورسالة الخطأ
  /// بتظهر **جنب زرار التأكيد تحت** — يعني بتقول للعميل إن فيه حاجة ناقصة فوق من غير ما توديه
  /// لها. هو مضطر يفضل يقلّب يدوي.
  ///
  /// الحل بسيط بالقدر اللي المالك اشترطه («لو تنفع تتعامل ببساطة»): مفتاح لكل قسم قابل
  /// للنقص، و`Scrollable.ensureVisible` بيوصّله. صفر مكتبات، صفر أثر على الأداء.
  final _addressSectionKey = GlobalKey();
  final _pricingFieldsSectionKey = GlobalKey();
  final _unitsSectionKey = GlobalKey();
  final _scheduleSectionKey = GlobalKey();

  /// نوع الكود اللي اتحقق منه بنجاح — `null` يعني لسه ما اتحققش أو الكود اتغيّر بعد التحقق.
  /// بيتحدد **من رد السيرفر** مش من شكل الكود: بنجرّب كود خصم، ولو مش موجود بنجرّب كود عمارة.
  String? _resolvedCodeKind; // 'promo' | 'building'
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
  bool _validatingCode = false;
  String? _codeError;

  /// الكود اللي هيتبعت كـ`promo_code` — فاضي إلا لو التحقق أثبت إنه كود خصم.
  String get _promoCodeToSend => _resolvedCodeKind == 'promo' ? _codeController.text.trim() : '';

  /// الكود اللي هيتبعت كـ`building_code` — نفس المنطق بالظبط.
  String get _buildingCodeToSend => _resolvedCodeKind == 'building' ? _codeController.text.trim() : '';
  String? _error;
  List<ServiceAddon> _addons = [];
  final Set<String> _selectedAddonIds = {};

  // محرك التسعير الديناميكي (docs/08 §1) — كانت فجوة موثّقة صراحة: apps/customer-app مفيهوش
  // شاشة تدخل بيها القيم اللازمة لحساب سعر خدمات pricing_model=formula، فالعميل مكانش يقدر
  // يحجز الخدمات دي أصلاً من التطبيق (كان المسار الوحيد اختبار مباشر بـ curl). اتقفلت.
  bool get _isFormulaPricing => widget.service.pricingModel == 'formula';
  bool get _isPerUnitPricing => widget.service.pricingModel == 'per_unit';
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
  final _pricingQuantityController = TextEditingController();

  // دقة الوقت (ADR-0031 Slice B) — service.requiresPreciseSchedule=true محتاجة وقت بداية دقيق
  // (مش يوم بس، ADR-0018) + مدة بالساعات. TimeOfDay منفصل عن _requestedAt (اللي بيحمل اليوم بس
  // من ScheduleSelectionScreen)، بيتدمجوا مع بعض وقت الإرسال (_combinedPreciseScheduledAt).
  TimeOfDay? _preciseTime;
  final _durationHoursController = TextEditingController();
  DurationEstimate? _durationEstimate;
  bool _estimatingDuration = false;
  String? _durationError;
  Timer? _durationDebounce;

  // وضع "بداية+نهاية" (ADR-0032) — service.requiresStartAndEnd=true محتاجة تاريخ ووقت كاملين
  // للاتنين، مستقلة تمامًا عن _requestedAt/_preciseTime فوق (عقد شهري/إقامة بمدة محددة).
  DateTime? _startAndEndStart;
  DateTime? _startAndEndEnd;

  // "كرّر الحجز ده" (migration 0176) — null = مرة واحدة (الافتراضي، صفر تغيير سلوك). الطلب
  // الحالي بيتعمل بالمسار العادي زي زمان، والباك-إند بينشئ قالب متكرر بنفس العملية أول موعد
  // له بعد الموعد المحجوز. الباك-إند بيرفضه للطوارئ/إعادة الزيارة/الخدمات غير مفعّل فيها
  // التكرار — هنا بنخفي الاختيار خالص في الحالات دي بدل ما نسيبه يترفض بعد التأكيد.
  String? _repeatFrequency;

  // Script 2 Part I (findings #46/#47/#48) — فاضية لحد ما /payment-channels يرد؛ زرار "ادفع بعد
  // الخدمة" (value: null) دايمًا ظاهر بغض النظر عن القيمة دي لأنه مش بيعتمد على أي provider خارجي.
  Map<String, PaymentChannelAvailability> _paymentChannels = {};
  List<OptionalWarrantyPlan> _optionalWarranties = [];
  bool _hasInstallmentPlans = false;
  String? _selectedWarrantyPlanId;
  String? _checkoutOptionsError;

  Set<String> get _availablePaymentMethods => _paymentChannels.values
      .where((channel) => channel.available)
      .map((channel) => channel.method)
      .toSet();

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _paymentsRepository = PaymentsRepository(context.read<AuthRepository>());
    _orderIdempotencyKey = _paymentsRepository.generateIdempotencyKey();
    _selectedAddress = widget.initialAddress;
    _requestedAt = widget.requestedAt;
    _requestedAtRangeEnd = widget.requestedAtRangeEnd;
    _preciseTime = widget.requestedPreciseTime;
    if (widget.requestedDurationHours != null) {
      _durationHoursController.text = widget.requestedDurationHours.toString();
    }
    if (widget.initialFieldValues != null) _fieldValues.addAll(widget.initialFieldValues!);
    _loadAddons();
    if (_isFormulaPricing) {
      _loadPricingFields();
    } else {
      _loadStandardData();
    }
    if (_selectedAddress != null) _refreshPreview();
    _loadCheckoutOptions();
  }

  // خدمة ممنوع فيها الكاش (service.cashAllowed=false) أو محتاجة إيداع مقدّم (pricePreview.depositAmountCents)
  // — الاتنين بيفرضوا دفع إلكتروني إجباري وقت التأكيد (orders.service.ts بيرفض غير كده بوضوح).
  bool get _requiresElectronicPayment => !widget.service.cashAllowed || _pricePreview?.depositAmountCents != null;

  // "كرّر الحجز ده" (migration 0176) — الاختيار بيظهر بس لما التكرار ممكن فعلاً: خدمة مفعّل
  // فيها التكرار + مش طوارئ + فيه موعد محدد نهائيًا (سلوت فني أو يوم محدد). خدمات "عدد ساعات
  // بس" مالهاش موعد محدد أصلاً فمينفعش تتكرر (نفس شرط الباك-إند بالحرف).
  bool get _canRepeat {
    if (_selectedWarrantyPlanId != null) return false;
    if (!widget.service.allowsRecurringBooking) return false;
    if (widget.bookingMode == BookingMode.emergency) return false;
    if (widget.scheduleSlotId != null) return true;
    if (widget.service.requiresHoursOnly) return false;
    final DateTime? at = widget.service.requiresStartAndEnd
        ? _startAndEndStart
        : (widget.service.requiresPreciseSchedule || widget.service.requiresStartTimeOnly)
            ? _combinedPreciseScheduledAt()
            : _requestedAt;
    return at != null;
  }

  // طلب مالك مباشر (2026-08-22): بَقّة تجربة كانت موجودة — "ادفع بعد الخدمة" (كاش) كان ظاهر دايمًا
  // بغض النظر عن service.cashAllowed/deposit_required، فالعميل يختاره ويترفض بعد ما يدوس "تأكيد
  // الطلب" برسالة حمرا بدل ما يعرف من الأول. الحل: نخفي الخيار ده تمامًا لما يبقى غير متاح، ونختار
  // أول طريقة إلكترونية متاحة تلقائيًا بدل ما نسيب الفورم بلا اختيار صالح.
  void _reconcilePaymentMethodSelection() {
    if (_selectedPaymentMethod != null &&
        (!_availablePaymentMethods.contains(_selectedPaymentMethod) ||
            (_selectedPaymentMethod == 'installment' && (!_hasInstallmentPlans || _requiresElectronicPayment)))) {
      _selectedPaymentMethod = null;
    }
    if (_requiresElectronicPayment && _selectedPaymentMethod == null) {
      if (_availablePaymentMethods.contains('card')) {
        _selectedPaymentMethod = 'card';
      } else if (_availablePaymentMethods.contains('instapay')) {
        _selectedPaymentMethod = 'instapay';
      } else if (_availablePaymentMethods.contains('fawry_reference')) {
        _selectedPaymentMethod = 'fawry_reference';
      }
    }
  }

  // فشل الجلب هنا مش خطير — بيسيب _availablePaymentMethods فاضية، يعني خياري الدفع الإلكتروني
  // مش هيظهروا (بدل ما يظهروا ويترفضوا لاحقًا)، و"ادفع بعد الخدمة" يفضل شغال عادي دايمًا.
  Future<void> _loadCheckoutOptions() async {
    List<PaymentChannelAvailability> channels = [];
    List<OptionalWarrantyPlan> warranties = [];
    var hasInstallmentPlans = false;
    String? channelError;
    try {
      channels = await _repository.fetchPaymentChannels();
    } catch (_) {
      channelError = 'تعذر تحميل طرق الدفع — اضغط لإعادة المحاولة';
    }
    try {
      warranties = await _repository.fetchOptionalWarranties(widget.service.id);
    } catch (_) {
      // الضمان اختياري؛ فشله لا يخفي طرق الدفع.
    }
    try {
      hasInstallmentPlans = await _repository.hasInstallmentPlans(widget.service.id);
    } catch (_) {
      // ستظهر طريقة التقسيط مع سبب عدم الجاهزية بدل اختفاء بقية القنوات.
    }
    if (!mounted) return;
    setState(() {
      _paymentChannels = {for (final channel in channels) channel.method: channel};
      _optionalWarranties = warranties;
      _hasInstallmentPlans = hasInstallmentPlans;
      _checkoutOptionsError = channelError;
      _reconcilePaymentMethodSelection();
    });
  }

  @override
  void dispose() {
    _priceDebounce?.cancel();
    _durationDebounce?.cancel();
    _requestedUnitsController.dispose();
    _pricingQuantityController.dispose();
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

  void _onPricingQuantityChanged(String _) {
    setState(() {
      _pricePreview = null;
      _previewError = null;
    });
    _priceDebounce?.cancel();
    _priceDebounce = Timer(const Duration(milliseconds: 400), _refreshPreview);
  }

  void _onDurationHoursChanged(String _) {
    setState(() {
      _pricePreview = null;
      _previewError = null;
    });
    _priceDebounce?.cancel();
    _priceDebounce = Timer(const Duration(milliseconds: 400), _refreshPreview);
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
  // الكود بيتبعت بس لما العميل يضغط "تحقق" صراحة (_validateCode) — مش أوتوماتيك مع كل
  // تعديل، عشان كود غلط وسط الكتابة ميغطّيش السعر الأساسي الصحيح.
  Future<void> _refreshPreview({String? promoCode, String? buildingCode}) async {
    if (_selectedAddress == null) return;
    if (_isFormulaPricing && !_pricingFieldsComplete) return;
    final pricingQuantity = num.tryParse(_pricingQuantityController.text.trim());
    if (_isPerUnitPricing && (pricingQuantity == null || pricingQuantity <= 0)) {
      return;
    }
    final durationHours = int.tryParse(_durationHoursController.text.trim());
    if (widget.service.pricingModel == 'hourly' &&
        (widget.service.requiresPreciseSchedule || widget.service.requiresHoursOnly) &&
        durationHours == null) {
      return;
    }
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
        warrantyPlanId: _selectedWarrantyPlanId,
        pricingQuantity: _isPerUnitPricing ? pricingQuantity : null,
        durationHours: widget.service.pricingModel == 'hourly' ? durationHours : null,
        scheduledAt: _combinedPreciseScheduledAt() ?? _requestedAt,
      );
      if (mounted && generation == _previewRequestGeneration) {
        setState(() {
          _pricePreview = result;
          _reconcilePaymentMethodSelection();
        });
      }
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
        _codeError = null;
      });
      _refreshPreview();
    }
  }

  // "تغيير الموعد" (docs/08 §154) — بلا أثر لو الطلب مربوط بسلوت جدولة محدد (widget.scheduleSlotId)،
  // ده موعد الفني نفسه المعلن، مش موعد حر قابل للتعديل من هنا.
  Future<void> _pickSchedule() async {
    final choice = await Navigator.of(context).push<ScheduleChoice>(
      MaterialPageRoute(
        builder: (_) => ScheduleSelectionScreen(
          allowsDateRangeBooking: widget.service.allowsDateRangeBooking,
          requiresPreciseTime: widget.service.requiresPreciseSchedule || widget.service.requiresStartTimeOnly,
          requiresDurationHours: widget.service.requiresPreciseSchedule,
          // **مدخل تاني لنفس الشاشة** (العميل بيغيّر الميعاد من شاشة تأكيد الطلب) — لازم ياخد
          // نفس البوابة بالظبط (ADR-0048)، وإلا كان فيه مسار يوصل لنفس اليوم من غير ما يشوف
          // تنبيه رسوم الاستعجال.
          allowsSameDay: widget.service.allowsEmergency,
        ),
      ),
    );
    if (choice != null && mounted) {
      setState(() {
        _requestedAt = choice.scheduledAt;
        _requestedAtRangeEnd = choice.rangeEnd;
        if (choice.preciseTime != null) _preciseTime = choice.preciseTime;
        if (choice.durationHours != null) _durationHoursController.text = choice.durationHours.toString();
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

  // وضع "بداية+نهاية" (ADR-0032) — تاريخ ووقت كاملين في نفس الخطوة (بعكس _pickSchedule/
  // _pickPreciseTime اللي بيقسّموا اليوم والساعة على شاشتين منفصلتين، لأن دي مستقلة تمامًا).
  Future<DateTime?> _pickFullDateTime(DateTime? initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: initial != null ? TimeOfDay.fromDateTime(initial) : const TimeOfDay(hour: 10, minute: 0),
    );
    if (time == null || !mounted) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _pickStartAndEndStart() async {
    final picked = await _pickFullDateTime(_startAndEndStart);
    if (picked != null && mounted) setState(() => _startAndEndStart = picked);
  }

  Future<void> _pickStartAndEndEnd() async {
    final picked = await _pickFullDateTime(_startAndEndEnd);
    if (picked != null && mounted) setState(() => _startAndEndEnd = picked);
  }

  String _formatFullDateTime(DateTime at) {
    final two = (int n) => n.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)}/${at.year} — ${two(at.hour)}:${two(at.minute)}';
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

  /// تحقق من الكود — **محاولة واحدة للعميل، محاولتان للنظام** (docs/08 §77-B4).
  ///
  /// العميل بيكتب كود واحد ومش عارف نوعه (خصم ولا عمارة) — ومفيش سبب يعرف. الدالة بتجرّب
  /// كود الخصم الأول، ولو السيرفر قال «مش موجود» بتجرّبه كود عمارة. أول واحد ينجح بيتسجّل
  /// نوعه في `_resolvedCodeKind` عشان الإرسال النهائي يبعته في الحقل الصح.
  ///
  /// **ليه بالترتيب ده؟** أكواد الخصم أكتر بكتير وأشيع، فالمحاولة الأولى بتنجح في الأغلبية
  /// الساحقة ومفيش نداء تاني أصلاً. ولو الاتنين فشلوا، العميل بيشوف رسالة واحدة — مش
  /// رسالتين بتقولوا نفس الحاجة بصيغتين.
  Future<void> _validateCode() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    if (_selectedAddress == null) {
      setState(() => _codeError = 'اختار عنوان الأول');
      return;
    }
    if (_isFormulaPricing && !_pricingFieldsComplete) {
      setState(() => _codeError = 'كمّل بيانات السعر الأول');
      return;
    }
    setState(() {
      _validatingCode = true;
      _codeError = null;
      _resolvedCodeKind = null;
    });
    final generation = ++_previewRequestGeneration;

    Future<OrderPricePreview> attempt({required bool asBuilding}) => _repository.previewPrice(
          serviceId: widget.service.id,
          addressId: _selectedAddress!.id,
          bookingMode: widget.bookingMode,
          requestedTechnicianId: widget.requestedTechnicianId,
          scheduleSlotId: widget.scheduleSlotId,
          fieldValues: _isFormulaPricing ? _fieldValues : null,
          addonIds: _selectedAddonIds.toList(),
          promoCode: asBuilding ? null : code,
          buildingCode: asBuilding ? code : null,
          warrantyPlanId: _selectedWarrantyPlanId,
          pricingQuantity: _isPerUnitPricing ? num.tryParse(_pricingQuantityController.text.trim()) : null,
          durationHours:
              widget.service.pricingModel == 'hourly' ? int.tryParse(_durationHoursController.text.trim()) : null,
          scheduledAt: _combinedPreciseScheduledAt() ?? _requestedAt,
        );

    try {
      OrderPricePreview result;
      String kind;
      try {
        result = await attempt(asBuilding: false);
        kind = 'promo';
      } on ApiException {
        // الكود مش كود خصم صالح — يبقى يمكن كود عمارة. لو ده كمان فشل، الاستثناء بيطلع
        // للـcatch اللي تحت ويتعرض كرسالة واحدة.
        result = await attempt(asBuilding: true);
        kind = 'building';
      }
      // فشل التحقق بيسيب آخر معاينة صح (من غير خصم) ظاهرة، مش بيمسحها — العميل يشوف
      // "الكود ده مش موجود" جنب حقل الكود، مش رقم فاضي بدل السعر الصحيح.
      if (mounted && generation == _previewRequestGeneration) {
        setState(() {
          _pricePreview = result;
          _resolvedCodeKind = kind;
          _reconcilePaymentMethodSelection();
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _codeError = err.message);
    } finally {
      if (mounted) setState(() => _validatingCode = false);
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
      } else if (method == 'fawry_reference') {
        final reference = await _paymentsRepository.payWithFawryReference(orderId, idempotencyKey);
        if (!mounted) return;
        await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => FawryReferenceScreen(orderId: orderId, reference: reference)),
        );
      }
    } on ApiException catch (err) {
      // مش هيمنع الانتقال لـOrderDetailScreen — العميل يقدر يعيد المحاولة من هناك لو الأزرار
      // موجودة، أو الطلب هيتلغى تلقائيًا لو ماكملش خلال المهلة (راجع تعليق _submit فوق).
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    }
  }

  /// بتودّي العميل للقسم الناقص وتعرض سبب المنع (docs/08 §77-B5).
  ///
  /// الترتيب مقصود: `setState` الأول عشان الرسالة تتكتب، وبعدين التمرير — عشان لو القسم
  /// الناقص هو نفسه اللي فيه الرسالة، يوصله والرسالة ظاهرة مش وهو لسه بيتبني.
  void _failValidation(String message, GlobalKey? section) {
    setState(() => _error = message);
    final target = section?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
      // 0.1 مش 0 عمدًا: بيسيب مسافة صغيرة فوق القسم فالعميل يشوف عنوانه مش أول بكسل منه.
      alignment: 0.1,
    );
  }

  Future<void> _submit() async {
    if (_selectedAddress == null) {
      _failValidation('اختار عنوان الأول', _addressSectionKey);
      return;
    }
    if (_isFormulaPricing) {
      if (_hasUnsupportedRequiredField) {
        setState(() => _error = 'الخدمة دي محتاجة تفاصيل (صور/موقع) مش مدعومة في التطبيق لسه — كلم الدعم لإتمام الحجز');
        return;
      }
      if (!_pricingFieldsComplete) {
        _failValidation('كمّل كل بيانات السعر المطلوبة الأول', _pricingFieldsSectionKey);
        return;
      }
    }
    final pricingQuantity = num.tryParse(_pricingQuantityController.text.trim());
    if (_isPerUnitPricing && (pricingQuantity == null || pricingQuantity <= 0)) {
      _failValidation('حدد عدد ${widget.service.unitNameAr ?? 'الوحدات'} المطلوبة', _unitsSectionKey);
      return;
    }
    // لازم نعرض السعر الحقيقي الكامل قبل ما نسمح بالتأكيد لأي نموذج تسعير — مفيش تأكيد "أعمى"
    // (docs/08 §2، طلب صريح: نفس المدخلات اللي هتتبعت لازم تتعرض قبل التأكيد بالظبط).
    if (_pricePreview == null) {
      setState(() => _error = 'استنى لحد ما السعر يتحسب');
      return;
    }
    // أوضاع التوقيت الثلاثة الجديدة (ADR-0032) — تحقق عميل واضح قبل ما نوصل لرسالة الباك-إند
    // الخام، نفس فلسفة تحقق العنوان/بيانات السعر فوق.
    if (widget.scheduleSlotId == null && widget.service.requiresStartAndEnd) {
      if (_startAndEndStart == null || _startAndEndEnd == null) {
        _failValidation('حدد تاريخ ووقت البداية والنهاية', _scheduleSectionKey);
        return;
      }
      if (!_startAndEndEnd!.isAfter(_startAndEndStart!)) {
        _failValidation('وقت النهاية لازم يكون بعد وقت البداية', _scheduleSectionKey);
        return;
      }
    }
    if (widget.scheduleSlotId == null &&
        widget.service.requiresHoursOnly &&
        int.tryParse(_durationHoursController.text.trim()) == null) {
      _failValidation('حدد عدد الساعات المطلوبة', _scheduleSectionKey);
      return;
    }
    if (widget.scheduleSlotId == null && widget.service.requiresStartTimeOnly && _combinedPreciseScheduledAt() == null) {
      _failValidation('حدد تاريخ ووقت بداية الخدمة', _scheduleSectionKey);
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
        // بينهم لو العميل غيّر الموعد هنا بعد ما اختار سلوت فني بعينه. وضع "بداية+نهاية" (ADR-0032)
        // بيستخدم _startAndEndStart المستقل، و"عدد ساعات بس" مالوش scheduled_at خالص (ASAP).
        scheduledAt: widget.scheduleSlotId != null
            ? null
            : widget.service.requiresStartAndEnd
                ? _startAndEndStart?.toUtc().toIso8601String()
                : widget.service.requiresHoursOnly
                    ? null
                    : (widget.service.requiresPreciseSchedule || widget.service.requiresStartTimeOnly
                            ? _combinedPreciseScheduledAt()
                            : _requestedAt)
                        ?.toUtc()
                        .toIso8601String(),
        // "مرن — اختار نطاق أيام" (docs/08 §32.3) — بتتجاهل بأمان لو فيه سلوت محدد أو وضع
        // "بداية+نهاية"/"عدد ساعات بس" الجديدين (نفس منطق scheduledAt فوق بالحرف).
        scheduledAtRangeEnd: widget.scheduleSlotId == null && !widget.service.requiresStartAndEnd && !widget.service.requiresHoursOnly
            ? _requestedAtRangeEnd?.toUtc().toIso8601String()
            : null,
        durationHours: (widget.service.requiresPreciseSchedule || widget.service.requiresHoursOnly)
            ? int.tryParse(_durationHoursController.text.trim())
            : null,
        // وضع "بداية+نهاية" (ADR-0032) — بس لخدمات requiresStartAndEnd=true.
        scheduledEndAt: widget.service.requiresStartAndEnd ? _startAndEndEnd?.toUtc().toIso8601String() : null,
        problemDescription: _descriptionController.text.trim(),
        promoCode: _promoCodeToSend,
        buildingCode: _buildingCodeToSend,
        addonIds: _selectedAddonIds.toList(),
        requestedTechnicianCompanyId: widget.requestedTechnicianCompanyId,
        fieldValues: _isFormulaPricing ? _fieldValues : null,
        standardDataId: _selectedStandardData?.id,
        requestedUnits: num.tryParse(_requestedUnitsController.text.trim()),
        pricingQuantity: _isPerUnitPricing ? pricingQuantity : null,
        paymentMethod: _selectedPaymentMethod == 'installment' ? null : _selectedPaymentMethod,
        warrantyPlanId: _selectedWarrantyPlanId,
        // "كرّر الحجز ده" (migration 0176) — بيتبعت بس لما الاختيار ظاهر ومختار فعلاً؛ أي حالة
        // مش قابلة للتكرار (طوارئ/خدمة مقفول التكرار/مفيش موعد محدد) القيمة هنا null أصلاً.
        repeatFrequency: _canRepeat ? _repeatFrequency : null,
        idempotencyKey: _orderIdempotencyKey,
      );
      // دفع قبل التوزيع (docs/08 §19 بند 1) — الطلب رجع pending_payment، لازم نوجّه العميل
      // لشاشة الدفع فورًا (مش نسيبه يكتشف بنفسه) — التوزيع مش هيبدأ غير بعد ما الدفع يتأكد.
      // فشل/إلغاء العميل لشاشة الدفع هنا مش نهاية العالم: الطلب فضل pending_payment،
      // sweepPendingPayment() في الباك-إند هيلغيه تلقائيًا لو العميل ماكملش خلال المهلة
      // (orders.payment_timeout_minutes) — مفيش طلب معلّق للأبد.
      if (order.orderStatus == 'pending_payment' && _selectedPaymentMethod != null && _selectedPaymentMethod != 'installment') {
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

  Widget _paymentOption({
    required String method,
    required String title,
    required String subtitle,
    required IconData icon,
    bool extraAllowed = true,
    String? extraUnavailableReason,
  }) {
    final channel = _paymentChannels[method];
    final available = channel?.available == true && extraAllowed;
    final reason = extraUnavailableReason ?? channel?.unavailableReason ??
        (_checkoutOptionsError != null ? 'تعذر التحقق من جاهزية الطريقة' : 'جاري التحقق من الجاهزية');
    return RadioListTile<String?>(
      value: method,
      groupValue: _selectedPaymentMethod,
      onChanged: available ? (value) => setState(() => _selectedPaymentMethod = value) : null,
      secondary: Icon(icon),
      title: Text(title),
      subtitle: Text(available ? subtitle : reason),
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
        if (preview.warrantyPriceCents > 0)
          _buildPriceLine('الضمان الاختياري', '+${_formatEgp(preview.warrantyPriceCents)}', color: Colors.blue),
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
        // سياسة إيداع (ADR-0027) — كانت فجوة موثّقة صراحة: الرقم ده كان محسوب بالباك-إند من زمان
        // (PreviewOrderResponseDto.deposit_amount_cents) بلا أي عرض هنا، فالعميل كان يشوف إجمالي
        // الطلب بس من غير ما يعرف إن جزء بس هيتحصّل دلوقتي والباقي بعدين.
        if (preview.depositAmountCents != null) ...[
          _buildPriceLine(
            'المطلوب دلوقتي (إيداع)',
            _formatEgp(preview.depositAmountCents!),
            bold: true,
            color: Theme.of(context).colorScheme.primary,
          ),
          _buildPriceLine('الباقي بعد ما الشغل يخلص', _formatEgp(preview.remainingAmountCents ?? 0)),
        ],
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
            key: _pricingFieldsSectionKey,
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
            Text(
              'عنوان الطلب',
              key: _addressSectionKey,
              style: Theme.of(context).textTheme.titleMedium,
            ),
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
              // وضع "عدد ساعات بس" (ADR-0032) — ASAP، من غير وقت بداية محدد خالص، فصف اختيار
              // اليوم بيتخفي تمامًا.
              if (widget.service.requiresHoursOnly) ...[
                Text(
                  'عدد الساعات المطلوبة',
                  key: _scheduleSectionKey,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _durationHoursController,
                  keyboardType: TextInputType.number,
                  onChanged: _onDurationHoursChanged,
                  decoration: const InputDecoration(labelText: 'عدد الساعات', border: OutlineInputBorder()),
                ),
              ]
              // وضع "بداية+نهاية" (ADR-0032) — تاريخ ووقت كاملين مستقلين للاتنين، مالوش علاقة
              // بصف اختيار اليوم العادي (_pickSchedule) خالص.
              else if (widget.service.requiresStartAndEnd) ...[
                Text(
                  'مدة الخدمة',
                  key: _scheduleSectionKey,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.event_outlined),
                    title: Text(
                      _startAndEndStart != null ? _formatFullDateTime(_startAndEndStart!) : 'حدد تاريخ ووقت البداية',
                    ),
                    trailing: const Icon(Icons.chevron_left),
                    onTap: _pickStartAndEndStart,
                  ),
                ),
                const SizedBox(height: 8),
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.event_available_outlined),
                    title: Text(
                      _startAndEndEnd != null ? _formatFullDateTime(_startAndEndEnd!) : 'حدد تاريخ ووقت النهاية',
                    ),
                    trailing: const Icon(Icons.chevron_left),
                    onTap: _pickStartAndEndEnd,
                  ),
                ),
              ] else ...[
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
                // دقة الوقت (ADR-0031 Slice B) + وضع "بداية بس" (ADR-0032) — الاتنين محتاجين
                // وقت بداية دقيق فوق اليوم المختار، بس دقة الوقت وحدها محتاجة مدة كمان تحت.
                if (widget.service.requiresPreciseSchedule || widget.service.requiresStartTimeOnly) ...[
                  const SizedBox(height: 8),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.schedule_outlined),
                      title: Text(_preciseTime != null ? 'الساعة ${_preciseTime!.format(context)}' : 'حدد وقت البداية'),
                      trailing: const Icon(Icons.chevron_left),
                      onTap: _pickPreciseTime,
                    ),
                  ),
                ],
                if (widget.service.requiresPreciseSchedule) ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: _durationHoursController,
                    keyboardType: TextInputType.number,
                    onChanged: _onDurationHoursChanged,
                    decoration: const InputDecoration(labelText: 'عدد الساعات المطلوبة', border: OutlineInputBorder()),
                  ),
                ],
              ],
            ],
            if (_isPerUnitPricing) ...[
              const SizedBox(height: 16),
              Text(
                'الكمية المطلوبة',
                key: _unitsSectionKey,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _pricingQuantityController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: _onPricingQuantityChanged,
                decoration: InputDecoration(
                  labelText: 'عدد ${widget.service.unitNameAr ?? 'الوحدات'}',
                  helperText: 'السعر يتحدث تلقائيًا حسب الكمية قبل تأكيد الطلب',
                  border: const OutlineInputBorder(),
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
            const SizedBox(height: 16),
            // حقل كود واحد (docs/08 §77-B4) — شوف تعليق `_codeController` للسبب الكامل.
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('order-discount-code'),
                    controller: _codeController,
                    decoration: InputDecoration(
                      labelText: 'كود خاص (خصم أو عمارة) — اختياري',
                      border: const OutlineInputBorder(),
                      // تأكيد إيجابي بعد نجاح التحقق: العميل يعرف إن الكود اتقبل فعلاً
                      // من غير ما يدوّر على الفرق في السعر.
                      suffixIcon: _resolvedCodeKind == null
                          ? null
                          : Icon(Icons.check_circle, color: Colors.green.shade600),
                      helperText: _resolvedCodeKind == 'building'
                          ? 'اتقبل ككود عمارة'
                          : _resolvedCodeKind == 'promo'
                              ? 'اتقبل ككود خصم'
                              : null,
                    ),
                    textCapitalization: TextCapitalization.characters,
                    // بَقّة حقيقية اتلقطت (مراجعة booking flow الشاملة 2026-08-12): لو العميل
                    // عدّل نص الكود بعد ما اتحقق منه، السعر المعروض كان يفضل من الكود القديم —
                    // ده بيمسح الخصم فورًا (بمعاينة تانية من غير كود) لحد ما يضغط "تحقق" تاني،
                    // عشان السعر المعروض دايمًا يطابق الكود اللي فعلاً هيتبعت وقت التأكيد.
                    onChanged: (_) {
                      setState(() {
                        _codeError = null;
                        _resolvedCodeKind = null;
                        _pricePreview = null;
                      });
                      _refreshPreview();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _validatingCode ? null : _validateCode,
                  child: _validatingCode
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('تحقق'),
                ),
              ],
            ),
            if (_codeError != null) ...[
              const SizedBox(height: 4),
              Text(_codeError!, style: const TextStyle(color: Colors.red)),
            ],
            // "كرّر الحجز ده" (migration 0176) — مرة واحدة (الافتراضي) / أسبوعي / شهري.
            // الطلب الحالي بيتعمل دلوقتي زي العادة بالظبط، والمواعيد الجاية بيتولّد منها طلبات
            // عادية كاملة بنفس التفاصيل — سعر كل موعد بيتحسب بسعر الخدمة وقتها (مش سعر مجمد).
            if (_canRepeat) ...[
              const SizedBox(height: 16),
              Text('تكرار الحجز', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Column(
                  children: [
                    RadioListTile<String?>(
                      value: null,
                      groupValue: _repeatFrequency,
                      onChanged: (value) => setState(() => _repeatFrequency = value),
                      title: const Text('مرة واحدة'),
                    ),
                    RadioListTile<String?>(
                      value: 'weekly',
                      groupValue: _repeatFrequency,
                      onChanged: (value) => setState(() => _repeatFrequency = value),
                      title: const Text('أسبوعي — نفس اليوم والوقت كل أسبوع'),
                    ),
                    RadioListTile<String?>(
                      value: 'monthly',
                      groupValue: _repeatFrequency,
                      onChanged: (value) => setState(() => _repeatFrequency = value),
                      title: const Text('شهري — نفس اليوم كل شهر'),
                    ),
                  ],
                ),
              ),
              if (_repeatFrequency != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'هيعتبر الحجز ده أول موعد، والمواعيد الجاية هيتولّد منها طلبات عادية بنفس التفاصيل '
                    '(نفس الفني لو متاح، وسعر كل موعد بيتحسب بسعر الخدمة وقتها). تقدر توقف التكرار في أي وقت من '
                    '"الحجوزات المتكررة" في حسابك.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              const SizedBox(height: 8),
            ],
            if (_optionalWarranties.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('ضمان إضافي (اختياري)', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(
                'سعر الضمان يضاف منفصلًا ويظهر في الإجمالي، والإيداع يُعاد حسابه على الإجمالي الجديد.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              Card(
                child: Column(
                  children: [
                    RadioListTile<String?>(
                      value: null,
                      groupValue: _selectedWarrantyPlanId,
                      onChanged: (value) {
                        setState(() {
                          _selectedWarrantyPlanId = value;
                          if (value != null) _repeatFrequency = null;
                        });
                        _refreshPreview(
                          promoCode: _promoCodeToSend.isEmpty ? null : _promoCodeToSend,
                          buildingCode: _buildingCodeToSend.isEmpty ? null : _buildingCodeToSend,
                        );
                      },
                      title: const Text('بدون ضمان إضافي'),
                      subtitle: Text(widget.service.warrantyDays > 0
                          ? 'الضمان الأساسي المجاني للخدمة يظل موجودًا'
                          : 'لن تضاف تكلفة ضمان'),
                    ),
                    ..._optionalWarranties.map((plan) => RadioListTile<String?>(
                          value: plan.id,
                          groupValue: _selectedWarrantyPlanId,
                          onChanged: (value) {
                            setState(() {
                              _selectedWarrantyPlanId = value;
                              if (value != null) _repeatFrequency = null;
                            });
                            _refreshPreview(
                              promoCode: _promoCodeToSend.isEmpty ? null : _promoCodeToSend,
                              buildingCode: _buildingCodeToSend.isEmpty ? null : _buildingCodeToSend,
                            );
                          },
                          title: Text('${plan.nameAr} — ${plan.coverageMonths} شهر'),
                          subtitle: Text(
                            plan.pricingModel == 'fixed'
                                ? '+${_formatEgp(plan.priceValue.round())}'
                                : '+${plan.priceValue.toStringAsFixed(plan.priceValue % 1 == 0 ? 0 : 1)}% من سعر الخدمة بعد الخصم',
                          ),
                        )),
                  ],
                ),
              ),
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
            // طلب مالك مباشر (2026-08-22) — رسالة واضحة قبل ما العميل يحاول يدفع، بدل ما يختار
            // "بعد الخدمة" ويترفض برسالة حمرا بعد ما يدوس "تأكيد الطلب".
            if (_pricePreview?.depositAmountCents != null) ...[
              Card(
                color: Theme.of(context).colorScheme.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.info_outline),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'الخدمة دي محتاجة دفع إيداع ${_formatEgp(_pricePreview!.depositAmountCents!)} دلوقتي، '
                          'والباقي (${_formatEgp(_pricePreview!.remainingAmountCents ?? 0)}) هيتحصّل تلقائيًا بعد ما '
                          'الشغل يخلص. الدفع لازم يكون بالبطاقة أو InstaPay أو فوري.',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ] else if (!widget.service.cashAllowed) ...[
              Card(
                color: Theme.of(context).colorScheme.secondaryContainer,
                child: const Padding(
                  padding: EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.info_outline),
                      SizedBox(width: 8),
                      Expanded(child: Text('الخدمة دي محتاجة دفع إلكتروني (بطاقة أو InstaPay أو فوري) مقدّم — الدفع بعد الخدمة مش متاح لها.')),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (_checkoutOptionsError != null) ...[
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: ListTile(
                  title: Text(_checkoutOptionsError!),
                  trailing: const Icon(Icons.refresh),
                  onTap: _loadCheckoutOptions,
                ),
              ),
              const SizedBox(height: 8),
            ],
            Card(
              child: Column(
                children: [
                  RadioListTile<String?>(
                    value: null,
                    groupValue: _requiresElectronicPayment ? '__electronic_required__' : _selectedPaymentMethod,
                    onChanged: !_requiresElectronicPayment &&
                            ((_paymentChannels['cash']?.available ?? false) ||
                                (_paymentChannels['wallet']?.available ?? false))
                        ? (value) => setState(() => _selectedPaymentMethod = value)
                        : null,
                    secondary: const Icon(Icons.payments_outlined),
                    title: const Text('ادفع بعد الخدمة (كاش أو محفظة)'),
                    subtitle: Text(_requiresElectronicPayment
                        ? 'غير متاح لأن الخدمة تتطلب دفعًا إلكترونيًا مقدمًا'
                        : ((_paymentChannels['cash']?.available ?? false) ||
                                (_paymentChannels['wallet']?.available ?? false))
                            ? 'تدفع بعد ما الفني يخلّص الشغل'
                            : 'مش متاح للخدمة دي دلوقتي'),
                  ),
                  _paymentOption(
                    method: 'card',
                    title: 'بطاقة بنكية — فيزا أو ماستركارد',
                    subtitle: 'تحويل آمن لصفحة الدفع، والتنفيذ بيبدأ بعد تأكيد العملية',
                    icon: Icons.credit_card_outlined,
                  ),
                  _paymentOption(
                    method: 'installment',
                    title: 'التقسيط',
                    subtitle: 'أنشئ الطلب ثم اختر الخطة وقدّمها لمراجعة الإدارة',
                    icon: Icons.calendar_month_outlined,
                    extraAllowed: !_requiresElectronicPayment && _hasInstallmentPlans,
                    extraUnavailableReason: _requiresElectronicPayment
                        ? 'التقسيط الحالي يحتاج مراجعة إدارة ولا يغطي الإيداع الفوري لهذه الخدمة'
                        : _paymentChannels['installment']?.available == true && !_hasInstallmentPlans
                            ? 'مفيش خطة تقسيط متاحة للخدمة دي'
                            : null,
                  ),
                  _paymentOption(
                    method: 'instapay',
                    title: 'الدفع عبر InstaPay',
                    subtitle: 'تحويل بكود مرجعي وتأكيد يدوي من فريق المالية',
                    icon: Icons.send_outlined,
                  ),
                  _paymentOption(
                    method: 'fawry_reference',
                    title: 'الدفع في فوري',
                    subtitle: 'تحصل على كود مرجعي صالح للدفع في أقرب منفذ فوري',
                    icon: Icons.storefront_outlined,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // النص القديم كان «وصف المشكلة (اختياري)» — بلاغ مالك صريح (docs/08 §76-هـ):
            // العميل مش عارف الكلام ده رايح لمين، فبيسيبه فاضي. التسمية دلوقتي بتقول الوجهة
            // بالاسم («الفني») بدل ما توصف المحتوى، وده اللي بيخلّي الحقل يتملي فعلاً.
            Text('رسالة للفني', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'اللي هتكتبه هنا بيوصل للفني قبل ما ييجي — تفاصيل المشكلة، مكان العطل، أو أي حاجة تحب ياخد باله منها.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                hintText: 'مثلاً: الحنفية بتنقّط من تحت الحوض في المطبخ',
                helperText: 'اختياري',
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
