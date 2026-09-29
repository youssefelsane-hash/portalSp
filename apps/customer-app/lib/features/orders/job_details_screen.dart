import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart';
import '../catalog/pricing_field_widgets.dart';
import '../support/support_contact_screen.dart';
import 'orders_repository.dart';

// P0-10 (2026-08-13، مراجعة أمان/جودة شاملة) — كانت فجوة حقيقية موثّقة: لخدمات pricing_model=
// formula، رحلة الحجز كانت "اختار فني → دخّل تفاصيل الشغل" (services_screen.dart كان بيودّي على
// طول لـTechnicianSelectionScreen)، يعني قايمة الفنيين كانت بتعرض كل الفنيين "بدون سعر نهائي"
// خالص — GET /services/:id/technicians محتاج field_values عشان يقدر يحسب final_price_cents لكل
// فني (راجع catalog.controller.ts). الشاشة دي بتقلب الترتيب لخدمات formula بس: عنوان + تفاصيل
// الشغل الأول، بعدين قايمة الفنيين وهي شايفة السعر النهائي الحقيقي فعليًا لكل واحد.
/// ناتج شاشة تفاصيل الشغل — العنوان + الحقول المؤثّرة في التنفيذ (ADR-0100).
///
/// الشاشة بقت **بترجّع** ناتجها بدل ما تكمّل التنقّل بنفسها، لأنها بقت **قبل** شاشة الميعاد:
/// الحقول دي هي مدخلات المدة، والمدة هي مدخل اقتراح الموعد. الشاشة اللي بتجمع مدخلات خطوة
/// جاية مينفعش تقرر هي رايحة فين.
class JobDetailsResult {
  final Address address;
  final Map<String, dynamic> fieldValues;

  const JobDetailsResult({required this.address, required this.fieldValues});
}

class JobDetailsScreen extends StatefulWidget {
  final CatalogService service;

  /// العنوان الحقيقي للطلب — بيتحدد **قبل** الشاشة دي دايمًا (ADR-0100).
  ///
  /// بقى إجباري: العنوان هو مصدر النطاق اللي المدة والاقتراح والتسعير كلهم بيتحسبوا عليه، فمافيش
  /// أي معنى لجمع تفاصيل الشغل قبل ما نعرفه.
  final Address initialAddress;

  // توحيد فلو "اعتماد" مع "فردي" (docs/08 §36+§38، طلب مالك صريح 2026-08-21 — اتصلحت بشكل مستقل
  // في سيشنين متوازيين).
  final BookingMode bookingMode;

  const JobDetailsScreen({
    super.key,
    required this.service,
    required this.initialAddress,
    this.bookingMode = BookingMode.individual,
  });

  @override
  State<JobDetailsScreen> createState() => _JobDetailsScreenState();
}

class _JobDetailsScreenState extends State<JobDetailsScreen> {
  final _catalogRepository = CatalogRepository();
  late Address _selectedAddress;
  List<PricingField> _pricingFields = [];
  bool _loadingPricingFields = false;
  String? _pricingFieldsError;
  final Map<String, dynamic> _fieldValues = {};
  final _formController = PricingFieldsFormController();

  @override
  void initState() {
    super.initState();
    // العنوان بيوصل جاهز دايمًا (ADR-0100) — الـpush بتاع `AddressesScreen` من جوّه `initState`
    // اتشال خلاص. (كان مصدر بَقّة حقيقية اتلقطت بالتشغيل الحي: النداء وهو الـNavigator لسه في
    // نص انيميشن الدخول بيرمي `navigator._debugLocked` جوّه microtask والشاشة تموت لأي لمسة.)
    _selectedAddress = widget.initialAddress;
    _loadPricingFields();
  }

  Future<void> _loadPricingFields() async {
    setState(() => _loadingPricingFields = true);
    try {
      final fields = await _catalogRepository.fetchPricingFields(
        widget.service.id,
      );
      if (mounted) {
        setState(() {
          _pricingFields = fields;
          // بَقّة حقيقية اتلقطت (مراجعة مالك مباشرة، نفس الإصلاح في create_order_screen.dart) —
          // راجع التعليق الكامل هناك.
          for (final field in fields) {
            if (_fieldValues.containsKey(field.fieldKey)) continue;
            // نفس تهيئة الويب (`pricingFieldInitialValue`): الافتراضي بيتبعت، والـcheckbox false.
            final initial = pricingFieldInitialValue(field);
            if (initial != null) _fieldValues[field.fieldKey] = initial;
          }
        });
      }
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      if (mounted) setState(() => _pricingFieldsError = err.message);
    } finally {
      if (mounted) setState(() => _loadingPricingFields = false);
    }
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(
        builder: (_) => const AddressesScreen(selectionMode: true),
      ),
    );
    // رجع من غير اختيار = سيبه على عنوانه الحالي. الشاشة مابقتش تقدر تبقى بلا عنوان أصلاً.
    if (address != null && mounted) setState(() => _selectedAddress = address);
  }


  bool get _hasUnsupportedRequiredField =>
      _pricingFields.any((f) => f.isRequired && !f.isSupported);

  void _onFieldValueChanged(String fieldKey, dynamic value) {
    setState(() {
      if (value == null || value == '') {
        _fieldValues.remove(fieldKey);
      } else {
        _fieldValues[fieldKey] = value;
      }
    });
  }

  /// بترجّع الناتج لـ`catalog_navigation` اللي بيكمّل لشاشة الميعاد — الشاشة دي بقت **قبلها**.
  ///
  /// الزرار مابقاش بيتقفل في صمت لما حقل ناقص (docs/08 §185): العميل كان بيشوف زرار رمادي ومش
  /// عارف ليه. دلوقتي الضغطة بتوديه لأول حقل ناقص وتقوله يعمل إيه فيه بالظبط.
  void _continueToSchedule() {
    final purpose = widget.service.pricingModel == 'formula'
        ? 'علشان نقدر نحسب السعر'
        : 'علشان نكمّل طلبك';
    if (_formController.revealFirstMissing(purpose: purpose) != null) return;
    Navigator.of(context).pop(
      JobDetailsResult(
        address: _selectedAddress,
        fieldValues: Map<String, dynamic>.from(_fieldValues),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canContinue = !_loadingPricingFields && !_hasUnsupportedRequiredField;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('تفاصيل الشغل: ${widget.service.nameAr}')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    _selectedAddress.displayTitle,
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
            // النص بيشرح **ليه** الحقول دي بدري كده (ADR-0100): هي اللي بتحدد المدة، والمدة
            // هي اللي بتخلّي المواعيد المقترحة حقيقية بدل تخمين على مدة الخدمة الافتراضية.
            Text(
              'دخّل تفاصيل الشغل الأول — منها بنحسب المدة المتوقعة، وبنقدر نقترح عليك مواعيد '
              'فيها مقدمي خدمة يقدروا يخلّصوا الشغل كامل فعلاً.',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            if (_loadingPricingFields)
              const Center(child: CircularProgressIndicator())
            else if (_pricingFieldsError != null)
              Text(
                _pricingFieldsError!,
                style: const TextStyle(color: Colors.red),
              )
            else if (_pricingFields.isNotEmpty) ...[
              Text('حدد تفاصيل طلبك', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: PricingFieldsForm(
                    controller: _formController,
                    fields: _pricingFields,
                    values: _fieldValues,
                    onChanged: _onFieldValueChanged,
                    onUploadImage: (pricingField, image) async =>
                        OrdersRepository(
                          context.read<AuthRepository>(),
                        ).uploadPricingFieldImage(
                          serviceId: widget.service.id,
                          fieldId: pricingField.id,
                          fileBytes: await image.readAsBytes(),
                          filename: image.name,
                        ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: canContinue ? _continueToSchedule : null,
              child: const Text('متابعة — اختار الميعاد'),
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
                  MaterialPageRoute(
                    builder: (_) => const SupportContactScreen(),
                  ),
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
