import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/arabic_time.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
import '../orders/booking_scheduled_at.dart';
import '../orders/create_order_screen.dart';
import 'models.dart';
import 'technician_marketplace_screen.dart';
import 'technicians_repository.dart';

// اختيار الفني قبل الحجز (docs/08 §1.5، مُعاد تصميمها Script 6 Part 6-7) — كانت الشاشة دي
// بتعرض كارت "اختار لي تلقائيًا" وقايمة الفنيين الكاملة (بالصور/التقييمات/الأسعار) في نفس
// الوقت — تحميل معلومات وقرارات زيادة عن اللازم في خطوة واحدة، عكس مبدأ progressive disclosure
// (docs/08 §Part 18). دلوقتي الخطوة الأولى بالظبط اختيارين كبيرين واضحين: تلقائي أو يدوي.
// القايمة الحقيقية (كروت المقارنة، الفرز) اتنقلت بالكامل لـTechnicianMarketplaceScreen ومش
// بتتحمّل أو تتعرض خالص لحد ما العميل يختار "يدوي" صراحة.
//
// **ADR-0118 §3 (طلب مالك 2026-10-03) — الترشيح التلقائي بقى الافتراضي**: سؤال «تلقائي ولا
// يدوي؟» اتشال. أول ما العنوان يتحدد أسطى بيرشّح على طول ويعرض المرشّح وسعره في الشاشة نفسها،
// و«اختار حد تاني بنفسك» تحته بيفتح السوق. خطوة أقل، والعميل بيشوف حاجة حقيقية من أول لحظة.
class TechnicianSelectionScreen extends StatefulWidget {
  final CatalogService service;

  // سياسة إلغاء الفني (docs/10) — لو اتبعت، الشاشة بتستخدمها بدل التنقل لـCreateOrderScreen
  // (نفس الشاشة، غرض مختلف: اختيار فني بديل لطلب موجود بالفعل، مش إنشاء طلب جديد). null يعني
  // السلوك الأصلي (اختيار فني قبل حجز جديد). في وضع الاستبدال ده، خطوة "تلقائي/يدوي" بتتخطى
  // بالكامل — الزرار اللي جاب العميل هنا (order_detail_screen's "اختار الفريق بنفسك") قرر
  // "يدوي" بالفعل، فمفيش داعي نسأله تاني.
  final void Function(String? requestedTechnicianId)? onManualSelect;

  // سياسة إلغاء الفني (docs/10) — لو اتبعت (وضع إعادة الاختيار)، القايمة مش هتعرض الفني ده.
  final String? excludeTechnicianId;

  // P0-10 (2026-08-13) — خدمات pricing_model=formula: JobDetailsScreen بتبعت العنوان
  // (اختاره العميل هناك بالفعل، مفيش داعي نكرر الاختيار) وfield_values (عشان القايمة تقدر
  // تحسب final_price_cents حقيقي لكل فني). null للخدمات التانية (السلوك الأصلي بالحرف — العميل
  // يختار عنوان هنا زي ما كان دايمًا).
  final Address? initialAddress;
  final Map<String, dynamic>? fieldValues;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — بتتمرر لقايمة الفنيين (GET .../technicians?
  // scheduled_at=...) عشان الأهلية المعروضة تبقى مطابقة فعليًا لتاريخ الطلب، ولـCreateOrderScreen
  // النهائية. null (وضع الاستبدال onManualSelect، أو الطوارئ) يعني بلا تفضيل تاريخ.
  final DateTime? requestedAt;
  // "مرن — اختار نطاق أيام" (docs/08 §32.3) — بتتمرر لـCreateOrderScreen بس (مش لقايمة الفنيين —
  // المعاينة هناك بتفترض يوم واحد، النطاق بيتحل فعليًا وقت إنشاء الطلب في الباك-إند).
  final DateTime? requestedAtRangeEnd;
  // دقة الوقت (docs/08 §84 جزء ج) — بتتمرر لـCreateOrderScreen بس (نفس requestedAtRangeEnd فوق).
  final TimeOfDay? requestedPreciseTime;
  // توحيد فلو "اعتماد" مع "فردي" (docs/08 §38، طلب مالك صريح 2026-08-21) — الشاشة دي بقت
  // تُستخدم للوضعين بالحرف. individual (الافتراضي) = صفر تغيير عن السلوك الحالي. اعتماد الشركات
  // في القايمة الموحّدة (TechnicianMarketplaceScreen) مربوط بـteam بس — onManualSelect (إعادة
  // اختيار فني بديل لطلب موجود، order_detail_screen.dart) عمداً بيفضل individual دايمًا لحد ما
  // مسار "استبدال قائد فريق" يتضاف صراحة لاحقًا (requestRematch() الحالي مالوش دعم شركة أصلاً).
  final BookingMode bookingMode;

  const TechnicianSelectionScreen({
    super.key,
    required this.service,
    this.bookingMode = BookingMode.individual,
    this.onManualSelect,
    this.excludeTechnicianId,
    this.initialAddress,
    this.fieldValues,
    this.requestedAt,
    this.requestedAtRangeEnd,
    this.requestedPreciseTime,
  });

  @override
  State<TechnicianSelectionScreen> createState() =>
      _TechnicianSelectionScreenState();
}

class _TechnicianSelectionScreenState extends State<TechnicianSelectionScreen> {
  Address? _selectedAddress;
  bool _previewingAuto = false;
  BookingMatchPreview? _autoPreview;
  String? _autoError;
  late final TechniciansRepository _techniciansRepository =
      TechniciansRepository(context.read<AuthRepository>());

  @override
  void initState() {
    super.initState();
    if (widget.initialAddress != null) {
      _selectedAddress = widget.initialAddress;
      _scheduleAutoMatch();
    } else {
      // بَقّة حقيقية اتلقطت بالتشغيل الحي (Xvfb+fluxbox، 2026-08-19): نفس بَقّة JobDetailsScreen —
      // Navigator.push جوّه initState مباشرة بيتصادم مع انيميشن دخول الشاشة الحالية لسه شغالة
      // (Navigator._debugLocked)، وبيسيب الشاشة ميتة تمامًا لأي تفاعل بعد كده. addPostFrameCallback
      // بيأجّل النداء لحد ما الفريم الحالي يخلص.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _pickAddress();
      });
    }
  }

  Future<void> _pickAddress() async {
    final address = await Navigator.of(context).push<Address>(
      MaterialPageRoute(
        builder: (_) => const AddressesScreen(selectionMode: true),
      ),
    );
    if (address == null) {
      // العميل رجع من غير ما يختار عنوان — مفيش داعي نفضل في شاشة فاضية، نرجعه للخلف.
      if (mounted) Navigator.of(context).pop();
      return;
    }
    setState(() => _selectedAddress = address);
    _scheduleAutoMatch();
  }

  /// وضع الاستبدال (`onManualSelect`) بيروح للسوق مباشرة، فمفيش ترشيح فيه.
  void _scheduleAutoMatch() {
    if (widget.onManualSelect != null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_startAutoMatch());
    });
  }

  /// **بنود 9-12 — «اختاروا لي الأنسب» بقى معاينة حقيقية.**
  ///
  /// قبل كده الزرار ده كان بيروح لإنشاء الطلب على طول، والعميل يأكد وهو ماشافش مين الفني ولا
  /// السعر النهائي بمستواه. دلوقتي بنجيب المرشّح وسعره الأول، نعرضهم، وبعد ما يوافق بنكمّل
  /// بالتذكرة — فالباك-إند بيعيد التحقق من نفس الفني ونفس السعر وقت الإنشاء.
  Future<void> _startAutoMatch() async {
    final address = _selectedAddress;
    if (address == null || _previewingAuto) return;
    setState(() {
      _previewingAuto = true;
      _autoPreview = null;
      _autoError = null;
    });
    try {
      final preview = await _techniciansRepository.createMatchPreview(
        serviceId: widget.service.id,
        addressId: address.id,
        selectionMode: 'auto',
        bookingMode: widget.bookingMode,
        // نفس المدخلات اللي هتتبعت في الإنشاء — البصمة لازم تطابق، والساعة جزء منها
        // لخدمات `requires_start_time_only` (docs/08 §150 بند ١).
        scheduledAt: bookingScheduledAtIso(
          requiresStartTime: widget.service.requiresStartTime,
          day: widget.requestedAt,
          preciseTime: widget.requestedPreciseTime,
        ),
        fieldValues: widget.fieldValues,
      );
      if (!mounted) return;
      setState(() => _autoPreview = preview);
    } catch (errRaw) {
      // أي استثناء (كاست عقد، تحليل JSON، بَقّة) بيتحوّل لرسالة —
      // مايتسابش يهرب فيسيب الشاشة معلّقة على التحميل للأبد.
      final err = ApiException.from(errRaw);
      // رسالة صريحة في مكان الكارت — ممنوع نكمّل في صمت على مرشّح مش موجود (بند 10).
      if (mounted) setState(() => _autoError = err.message);
    } finally {
      if (mounted) setState(() => _previewingAuto = false);
    }
  }

  void _confirmAutoPreview(BookingMatchPreview preview) {
    // التذكرة ليها عمر؛ العميل ممكن يكون فتح السوق ورجع بعد ما خلصت — نرشّح من جديد بدل ما
    // يوصل لشاشة التأكيد ويترفض هناك.
    if (!preview.expiresAt.isAfter(DateTime.now())) {
      unawaited(_startAutoMatch());
      return;
    }
    _confirmSelection(
      // ADR-0080 — المرشّح ممكن يبقى شركة، ومعرّفها مكانه خانة الشركة.
      requestedTechnicianId: preview.isCompany ? null : preview.provider.id,
      requestedTechnicianCompanyId: preview.isCompany
          ? preview.provider.id
          : null,
      matchPreviewId: preview.matchPreviewId,
    );
  }

  void _confirmSelection({
    String? requestedTechnicianId,
    String? requestedTechnicianCompanyId,
    DateTime? effectiveRequestedAt,
    String? matchPreviewId,
  }) {
    if (widget.onManualSelect != null) {
      // onManualSelect (reselection على طلب موجود) عمداً individual بس — راجع تعليق bookingMode
      // فوق. requestedTechnicianCompanyId مستحيل يوصل هنا فعليًا (القايمة الموحّدة مش بتدمج
      // شركات إلا لو bookingMode=team، وده مش بيحصل في المسار ده).
      widget.onManualSelect!(requestedTechnicianId);
      return;
    }
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => CreateOrderScreen(
          service: widget.service,
          bookingMode: widget.bookingMode,
          requestedTechnicianId: requestedTechnicianId,
          requestedTechnicianCompanyId: requestedTechnicianCompanyId,
          initialAddress: _selectedAddress,
          initialFieldValues: widget.fieldValues,
          // ADR-0030 Slice D — لو العميل جرّب "احجزه في المعاد ده بدلاً" على فني كان متعارض
          // جدوليًا، effectiveRequestedAt بيحمل المعاد الجديد ده بدل widget.requestedAt الأصلي.
          requestedAt: effectiveRequestedAt ?? widget.requestedAt,
          requestedAtRangeEnd: widget.requestedAtRangeEnd,
          requestedPreciseTime: widget.requestedPreciseTime,
          matchPreviewId: matchPreviewId,
        ),
      ),
    );
  }

  /// **بند 12 — الاختيار اليدوي بيتقفل بتذكرة زي التلقائي بالظبط.**
  ///
  /// من غير التذكرة، `requested_technician_id` بيفضل **تفضيل** المحرك يقدر يستبدله لو الفني بقى
  /// مش متاح — يعني نفس باب الاستبدال الصامت اللي ADR-0065 قفله، بس مفتوح من ناحية الواجهة.
  ///
  /// **ADR-0080 — الشركة بقت تتقفل بتذكرة زي الفني بالظبط.** كانت مستثناة لأن `match-preview`
  /// ماكانش بياخد إلا `technician_id`؛ دلوقتي بياخد شركة كمان (بيوزّع جوّاها ويقفل السعر
  /// بمعاملها). من غير التذكرة كان اختيار الشركة بيفضل تفضيل بلا قفل سعر — أضعف من الويب.
  Future<void> _selectManualProvider(
    String id,
    bool isCompany,
    DateTime? effectiveRequestedAt,
  ) async {
    final address = _selectedAddress;
    if (address == null) {
      _confirmSelection(
        requestedTechnicianId: isCompany ? null : id,
        requestedTechnicianCompanyId: isCompany ? id : null,
        effectiveRequestedAt: effectiveRequestedAt,
      );
      return;
    }
    try {
      final preview = await _techniciansRepository.createMatchPreview(
        serviceId: widget.service.id,
        addressId: address.id,
        selectionMode: 'manual',
        bookingMode: widget.bookingMode,
        technicianId: isCompany ? null : id,
        technicianCompanyId: isCompany ? id : null,
        scheduledAt: bookingScheduledAtIso(
          requiresStartTime: widget.service.requiresStartTime,
          day: effectiveRequestedAt ?? widget.requestedAt,
          preciseTime: widget.requestedPreciseTime,
        ),
        fieldValues: widget.fieldValues,
      );
      if (!mounted) return;
      _confirmSelection(
        requestedTechnicianId: isCompany ? null : id,
        requestedTechnicianCompanyId: isCompany ? id : null,
        effectiveRequestedAt: effectiveRequestedAt,
        matchPreviewId: preview.matchPreviewId,
      );
    } on ApiException {
      // شاشة السوق هي التي تظل ظاهرة وقت الاختيار، لذلك هي المسؤولة عن عرض الخطأ؛ عرضه
      // من الشاشة الخلفية كان يجعل العميل يضغط الزر ولا يرى شيئًا.
      rethrow;
    }
  }

  void _openMarketplace() {
    final address = _selectedAddress;
    if (address == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TechnicianMarketplaceScreen(
          service: widget.service,
          address: address,
          excludeTechnicianId: widget.excludeTechnicianId,
          fieldValues: widget.fieldValues,
          requestedAt: widget.requestedAt,
          bookingMode: widget.bookingMode,
          onSelect: (id, isCompany, effectiveRequestedAt) =>
              _selectManualProvider(id, isCompany, effectiveRequestedAt),
        ),
      ),
    );
  }

  Widget _buildAutoMatch() {
    final preview = _autoPreview;
    final team = widget.bookingMode == BookingMode.team;
    if (preview != null) {
      return _AutoMatchCard(
        preview: preview,
        onConfirm: () => _confirmAutoPreview(preview),
        onChooseOther: _openMarketplace,
      );
    }
    if (_autoError != null && !_previewingAuto) {
      return Card(
        key: const ValueKey('auto-match-failed'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _autoError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _openMarketplace,
                child: Text(
                  team ? 'اختار الفريق بنفسك' : 'اختار بنفسك من القايمة',
                ),
              ),
              TextButton(
                onPressed: () => unawaited(_startAutoMatch()),
                child: const Text('حاول تاني'),
              ),
            ],
          ),
        ),
      );
    }
    return Card(
      key: const ValueKey('auto-match-loading'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                team
                    ? 'بندوّر لك على أنسب فريق متاح في الميعاد ده…'
                    : 'بندوّر لك على أنسب أسطى متاح في الميعاد ده…',
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final address = _selectedAddress;

    if (address != null && widget.onManualSelect != null) {
      return TechnicianMarketplaceScreen(
        service: widget.service,
        address: address,
        excludeTechnicianId: widget.excludeTechnicianId,
        fieldValues: widget.fieldValues,
        requestedAt: widget.requestedAt,
        bookingMode: widget.bookingMode,
        // onManualSelect (استبدال فني لطلب موجود بالفعل) بيستخدم requestedTechnicianId بس —
        // معاد الطلب نفسه ثابت بالفعل، فمفيش داعي لـeffectiveRequestedAt هنا.
        onSelect: (id, isCompany, _) async {
          _confirmSelection(
            requestedTechnicianId: isCompany ? null : id,
            requestedTechnicianCompanyId: isCompany ? id : null,
          );
        },
      );
    }

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.bookingMode == BookingMode.team
                ? 'اختار الفريق: ${widget.service.nameAr}'
                : 'اختار مقدم الخدمة: ${widget.service.nameAr}',
          ),
        ),
        body: address == null
            ? const SizedBox.shrink() // لسه بيختار عنوان (AddressesScreen فوقها)
            : Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton.icon(
                        onPressed: _pickAddress,
                        icon: const Icon(
                          Icons.edit_location_alt_outlined,
                          size: 18,
                        ),
                        label: const Text('تغيير العنوان'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: SingleChildScrollView(child: _buildAutoMatch()),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// كارت المرشّح اللي المحرك اختاره — بيتعرض **قبل** التأكيد (بنود 9-12).
///
/// بيقول تلات حاجات: مين، بكام، ولحد إمتى السعر ده محجوز. من غير الكارت ده الترشيح التلقائي
/// بيبقى تأكيد على المجهول. بقى جوّه الشاشة نفسها بدل bottom sheet (ADR-0118 §3).
class _AutoMatchCard extends StatelessWidget {
  const _AutoMatchCard({
    required this.preview,
    required this.onConfirm,
    required this.onChooseOther,
  });

  final BookingMatchPreview preview;
  final VoidCallback onConfirm;
  final VoidCallback onChooseOther;

  @override
  Widget build(BuildContext context) {
    final provider = preview.provider;
    return Card(
      key: const ValueKey('auto-match-result'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('رشّحنا لك', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundImage: provider.avatarUrl != null
                      ? NetworkImage(provider.avatarUrl!)
                      : null,
                  child: provider.avatarUrl == null
                      ? Icon(
                          preview.isCompany
                              ? Icons.groups_outlined
                              : Icons.person_outline,
                        )
                      : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        provider.fullName,
                        style: const TextStyle(fontWeight: FontWeight.bold),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '${provider.averageRating.toStringAsFixed(1)} (${provider.totalRatingsCount})'
                        '${provider.distanceKm != null ? ' · ${provider.distanceKm!.toStringAsFixed(1)} كم' : ''}',
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Text(
                  '${(preview.totalAmountCents / 100).toStringAsFixed(2)} ج.م',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              // الوقت بيعدّي على `formatArabicTime` (بلا `AM/PM` ومعزول اتجاهيًا) — ده اللي
              // كان بيقلب الجملة على الشاشة (docs/08 §152). الشرح الكامل في `core/arabic_time.dart`.
              'السعر ده محجوز لك مع الأسطى ده لحد '
              '${formatArabicTimeOfDay(preview.expiresAt)} — '
              'ولو غيّرت أي تفصيلة هنرشّح لك من جديد.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: onConfirm,
              child: Text(
                preview.isCompany
                    ? 'تمام، كمّل مع الشركة دي'
                    : 'تمام، كمّل بالأسطى ده',
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: onChooseOther,
              child: const Text('اختار حد تاني بنفسك'),
            ),
          ],
        ),
      ),
    );
  }
}
