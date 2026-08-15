import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../orders/create_order_screen.dart';
import '../orders/job_details_screen.dart';
import '../support/support_contact_screen.dart';
import '../technicians/technician_selection_screen.dart';
import 'catalog_repository.dart';
import 'models.dart';

class ServicesScreen extends StatefulWidget {
  final ServiceCategory category;
  final BookingMode bookingMode;

  const ServicesScreen({super.key, required this.category, required this.bookingMode});

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  final _repository = CatalogRepository();
  List<CatalogService>? _services;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final services = await _repository.fetchServices(
        categoryId: widget.category.id,
        bookingMode: widget.bookingMode,
      );
      if (mounted) setState(() => _services = services);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  // مساعدة حجز بسيطة (docs/08 §22 addendum) — العميل بيدوّر على مشكلته هنا؛ لو مش لاقيها في
  // القايمة، مفيش محرك تسعير تاني ولا فورم إضافي — مخرج بسيط ومباشر بس (اتصال/واتساب).
  Widget _problemNotListedFooter(BuildContext context) => Padding(
        padding: const EdgeInsets.all(16),
        child: OutlinedButton.icon(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SupportContactScreen()),
          ),
          icon: const Icon(Icons.help_outline),
          label: const Text('مشكلتك مش من ضمن اللي فوق؟ كلّمنا'),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(widget.category.nameAr)),
        body: _error != null
            ? Center(child: Text(_error!))
            : _services == null
                ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                : _services!.isEmpty
                    ? Column(
                        children: [
                          Expanded(
                            child: Center(
                              child: EmptyState(
                                icon: Icons.build_outlined,
                                title: 'مفيش خدمات "${widget.bookingMode.labelAr}" في الفئة دي دلوقتي',
                              ),
                            ),
                          ),
                          _problemNotListedFooter(context),
                        ],
                      )
                    : Column(
                        children: [
                          Expanded(
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _services!.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final service = _services![index];
                                return Card(
                                  child: ListTile(
                                    title: Text(service.nameAr),
                                    subtitle: service.shortDescriptionAr != null
                                        ? Text(service.shortDescriptionAr!)
                                        : null,
                                    // بَقّة حقيقية اتلقطت: خدمات pricing_model=formula بيتعرض ليها
                                    // basePriceCents (غالبًا صفر أو رقم داخلي مش مستخدم فعليًا —
                                    // السعر الحقيقي بيتحسب بالكامل من محرك التسعير الديناميكي بعد
                                    // ما العميل يملى تفاصيل الشغل) بدل ما توضّح إن السعر مش ثابت.
                                    trailing: Text(
                                      service.pricingModel == 'formula'
                                          ? 'يُحسب حسب التفاصيل'
                                          : _formatEgp(service.basePriceCents),
                                      style: Theme.of(context).textTheme.titleMedium,
                                    ),
                                    onTap: () => Navigator.of(context).push(
                                      MaterialPageRoute(
                                        // اختيار الفني قبل الحجز (docs/08 §3) بس للحجز الفردي —
                                        // "اعتماد" (team) ليها اختيار شركة/فريق منفصل جوّه
                                        // CreateOrderScreen نفسها، و"طوارئ" بتتوزّع تلقائيًا
                                        // بالكامل (مفيش وقت لاختيار يدوي). P0-10 (2026-08-13) —
                                        // خدمات formula تحديدًا لازم تجمع تفاصيل الشغل
                                        // (JobDetailsScreen) *قبل* قايمة الفنيين، وإلا القايمة
                                        // بتعرض كل الفنيين بلا سعر نهائي (محتاج field_values
                                        // يتحسب).
                                        builder: (_) => widget.bookingMode != BookingMode.individual
                                            ? CreateOrderScreen(service: service, bookingMode: widget.bookingMode)
                                            : service.pricingModel == 'formula'
                                                ? JobDetailsScreen(service: service)
                                                : TechnicianSelectionScreen(service: service),
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                          _problemNotListedFooter(context),
                        ],
                      ),
      ),
    );
  }
}
