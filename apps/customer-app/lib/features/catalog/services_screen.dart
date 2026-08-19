import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../../design/network_image_box.dart';
import '../support/support_contact_screen.dart';
import 'catalog_navigation.dart';
import 'catalog_repository.dart';
import 'models.dart';

// Script 3 §32/§35 — كانت الشاشة دي تفلتر بـbookingMode مُختار مسبقًا (قبل ما العميل يشوف
// الخدمات أصلاً). دلوقتي بتعرض كل خدمات الفئة بغض النظر عن الوضع، ووضع الحجز بيتقرر بعد اختيار
// خدمة معيّنة (catalog_navigation.dart's navigateToServiceBooking) وبس لو الخدمة فعلاً بتدعم
// أكتر من وضع.
class ServicesScreen extends StatefulWidget {
  final ServiceCategory category;

  const ServicesScreen({super.key, required this.category});

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
      final services = await _repository.fetchServices(categoryId: widget.category.id);
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
                                title: 'مفيش خدمات في "${widget.category.nameAr}" دلوقتي',
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
                                    leading: SizedBox(
                                      width: 56,
                                      height: 56,
                                      child: NetworkImageBox(
                                        imageUrl: service.iconUrl,
                                        placeholderIcon: Icons.build_outlined,
                                        aspectRatio: 1,
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                    ),
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
                                    onTap: () => navigateToServiceBooking(context, service),
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
