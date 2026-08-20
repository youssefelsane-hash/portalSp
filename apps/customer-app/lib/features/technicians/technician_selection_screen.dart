import 'package:flutter/material.dart';
import '../addresses/addresses_screen.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
import '../orders/create_order_screen.dart';
import 'technician_marketplace_screen.dart';

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

  const TechnicianSelectionScreen({
    super.key,
    required this.service,
    this.onManualSelect,
    this.excludeTechnicianId,
    this.initialAddress,
    this.fieldValues,
    this.requestedAt,
    this.requestedAtRangeEnd,
  });

  @override
  State<TechnicianSelectionScreen> createState() => _TechnicianSelectionScreenState();
}

class _TechnicianSelectionScreenState extends State<TechnicianSelectionScreen> {
  Address? _selectedAddress;

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

  void _confirmSelection({String? requestedTechnicianId}) {
    if (widget.onManualSelect != null) {
      widget.onManualSelect!(requestedTechnicianId);
      return;
    }
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => CreateOrderScreen(
          service: widget.service,
          bookingMode: BookingMode.individual,
          requestedTechnicianId: requestedTechnicianId,
          initialAddress: _selectedAddress,
          initialFieldValues: widget.fieldValues,
          requestedAt: widget.requestedAt,
          requestedAtRangeEnd: widget.requestedAtRangeEnd,
        ),
      ),
    );
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
          onSelect: (id) => _confirmSelection(requestedTechnicianId: id),
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
        onSelect: (id) => _confirmSelection(requestedTechnicianId: id),
      );
    }

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('اختار الفني: ${widget.service.nameAr}')),
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
                      'إزاي حابب تختار الفني؟',
                      style: Theme.of(context).textTheme.titleLarge,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    _ChoiceCard(
                      icon: Icons.bolt,
                      title: 'اختاروا لي الأنسب',
                      subtitle: 'هنبعت الطلب لأنسب فني متاح فورًا حسب تقييمه وقربه منك',
                      onTap: () => _confirmSelection(),
                      highlighted: true,
                    ),
                    const SizedBox(height: 16),
                    _ChoiceCard(
                      icon: Icons.people_outline,
                      title: 'اختار الفريق بنفسك',
                      subtitle: 'شوف قايمة الفنيين المتاحين وقارن بينهم قبل ما تختار',
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
