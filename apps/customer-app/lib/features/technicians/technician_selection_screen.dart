import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
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
  State<TechnicianSelectionScreen> createState() => _TechnicianSelectionScreenState();
}

class _TechnicianSelectionScreenState extends State<TechnicianSelectionScreen> {
  Address? _selectedAddress;
  bool _previewingAuto = false;
  late final TechniciansRepository _techniciansRepository =
      TechniciansRepository(context.read<AuthRepository>());

  @override
  void initState() {
    super.initState();
    if (widget.initialAddress != null) {
      _selectedAddress = widget.initialAddress;
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
      MaterialPageRoute(builder: (_) => const AddressesScreen(selectionMode: true)),
    );
    if (address == null) {
      // العميل رجع من غير ما يختار عنوان — مفيش داعي نفضل في شاشة فاضية، نرجعه للخلف.
      if (mounted) Navigator.of(context).pop();
      return;
    }
    setState(() => _selectedAddress = address);
  }

  /// **بنود 9-12 — «اختاروا لي الأنسب» بقى معاينة حقيقية.**
  ///
  /// قبل كده الزرار ده كان بيروح لإنشاء الطلب على طول، والعميل يأكد وهو ماشافش مين الفني ولا
  /// السعر النهائي بمستواه. دلوقتي بنجيب المرشّح وسعره الأول، نعرضهم، وبعد ما يوافق بنكمّل
  /// بالتذكرة — فالباك-إند بيعيد التحقق من نفس الفني ونفس السعر وقت الإنشاء.
  Future<void> _startAutoMatch() async {
    final address = _selectedAddress;
    if (address == null) return;
    setState(() => _previewingAuto = true);
    try {
      final preview = await _techniciansRepository.createMatchPreview(
        serviceId: widget.service.id,
        addressId: address.id,
        selectionMode: 'auto',
        // نفس المدخلات اللي هتتبعت في الإنشاء — البصمة لازم تطابق.
        scheduledAt: widget.requestedAt?.toUtc().toIso8601String(),
        fieldValues: widget.fieldValues,
      );
      if (!mounted) return;
      final accepted = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _AutoMatchPreviewSheet(preview: preview),
      );
      if (accepted != true || !mounted) return;
      _confirmSelection(
        requestedTechnicianId: preview.provider.id,
        matchPreviewId: preview.matchPreviewId,
      );
    } on ApiException catch (err) {
      // رسالة صريحة — ممنوع نكمّل في صمت على مرشّح مش موجود (بند 10).
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
    } finally {
      if (mounted) setState(() => _previewingAuto = false);
    }
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
  /// الشركات مستثناة: `match-preview` بياخد `technician_id` بس، فالشركة بتفضل على السلوك القديم
  /// لحد ما الباك-إند يدعمها. مذكور صراحة عشان مايتقريش كسهو.
  Future<void> _selectManualProvider(String id, bool isCompany, DateTime? effectiveRequestedAt) async {
    final address = _selectedAddress;
    if (isCompany || address == null) {
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
        technicianId: id,
        scheduledAt: (effectiveRequestedAt ?? widget.requestedAt)?.toUtc().toIso8601String(),
        fieldValues: widget.fieldValues,
      );
      if (!mounted) return;
      _confirmSelection(
        requestedTechnicianId: id,
        effectiveRequestedAt: effectiveRequestedAt,
        matchPreviewId: preview.matchPreviewId,
      );
    } on ApiException catch (err) {
      // الفني اللي اختاره بقى مش متاح — رسالة صريحة، وممنوع نكمّل على تفضيل ممكن يتبدّل.
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
      }
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
              unawaited(_selectManualProvider(id, isCompany, effectiveRequestedAt)),
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
        onSelect: (id, isCompany, _) => _confirmSelection(
          requestedTechnicianId: isCompany ? null : id,
          requestedTechnicianCompanyId: isCompany ? id : null,
        ),
      );
    }

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.bookingMode == BookingMode.team
                ? 'اختار الفريق: ${widget.service.nameAr}'
                : 'اختار الفني: ${widget.service.nameAr}',
          ),
        ),
        body: address == null
            ? const SizedBox.shrink() // لسه بيختار عنوان (AddressesScreen فوقها)
            : Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton.icon(
                        onPressed: _pickAddress,
                        icon: const Icon(Icons.edit_location_alt_outlined, size: 18),
                        label: const Text('تغيير العنوان'),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      widget.bookingMode == BookingMode.team ? 'إزاي حابب تختار الفريق/الشركة؟' : 'إزاي حابب تختار الفني؟',
                      style: Theme.of(context).textTheme.titleLarge,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    _ChoiceCard(
                      icon: Icons.bolt,
                      title: 'اختاروا لي الأنسب',
                      subtitle: widget.bookingMode == BookingMode.team
                          ? 'هنبعت الطلب لأنسب فريق/شركة متاحة فورًا حسب تقييمها وقربها منك'
                          : 'هنبعت الطلب لأنسب فني متاح فورًا حسب تقييمه وقربه منك',
                      onTap: _previewingAuto ? () {} : () => unawaited(_startAutoMatch()),
                      highlighted: true,
                    ),
                    const SizedBox(height: 16),
                    _ChoiceCard(
                      icon: Icons.people_outline,
                      title: 'اختار الفريق بنفسك',
                      subtitle: widget.bookingMode == BookingMode.team
                          ? 'شوف قايمة الفنيين المؤهّلين والشركات المتاحة وقارن بينهم قبل ما تختار'
                          : 'شوف قايمة الفنيين المتاحين وقارن بينهم قبل ما تختار',
                      onTap: _openMarketplace,
                    ),
                    const Spacer(flex: 2),
                  ],
                ),
              ),
      ),
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool highlighted;

  const _ChoiceCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.highlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: highlighted ? scheme.primaryContainer : null,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, size: 32, color: highlighted ? scheme.onPrimaryContainer : scheme.primary),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left),
            ],
          ),
        ),
      ),
    );
  }
}

/// كارت المرشّح اللي المحرك اختاره — بيتعرض **قبل** التأكيد (بنود 9-12).
///
/// بيقول تلات حاجات: مين، بكام، ولحد إمتى السعر ده محجوز. من غير الكارت ده «اختاروا لي الأنسب»
/// بيبقى تأكيد على المجهول.
class _AutoMatchPreviewSheet extends StatelessWidget {
  const _AutoMatchPreviewSheet({required this.preview});

  final BookingMatchPreview preview;

  @override
  Widget build(BuildContext context) {
    final provider = preview.provider;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
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
                  backgroundImage: provider.avatarUrl != null ? NetworkImage(provider.avatarUrl!) : null,
                  child: provider.avatarUrl == null ? const Icon(Icons.person_outline) : null,
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
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'السعر ده محجوز لك مع الأسطى ده لحد '
              '${TimeOfDay.fromDateTime(preview.expiresAt.toLocal()).format(context)}. '
              'لو غيّرت أي تفصيلة هنرشّح من جديد.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('تمام، كمّل بالأسطى ده'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('رجوع'),
            ),
          ],
        ),
      ),
    );
  }
}
