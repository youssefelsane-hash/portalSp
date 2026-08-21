import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'technicians_repository.dart';

// إصلاح بَقّة حقيقية اتبلّغت من المالك (docs/08 §36): وضع "اعتماد" (شغلانة كبيرة محتاجة فريق/
// شركة) كان بيقفز مباشرة لـCreateOrderScreen بكل حاجة (عنوان + مدخلات + دفع + تأكيد) في صفحة
// واحدة، عكس وضع "فردي" اللي بيمشي بخطوات منفصلة واضحة (يوم → عنوان/تفاصيل → اختيار → مراجعة
// نهائية). الشاشة دي هي مكافئ TechnicianMarketplaceScreen لكن لاختيار شركة/فريق بدل فني فرد —
// نفس المعنى اللي كان موجود بالفعل كقايمة radio اختيارية جوّه CreateOrderScreen (§18 قديمًا)، دلوقتي
// بقى خطوة منفصلة زي ما المالك طلب بالظبط ("خلي الفلو بتاع اعتماد هو هو نفس الفلو بتاع شغلانة
// وسيطة أو خفيفة"). GET /technician-companies بلا اعتماد على عنوان (مفيش فلترة جغرافية للشركات
// حاليًا)، فمفيش داعي لتحميل عنوان الأول زي قايمة الفنيين الفردية.
class CompanyMarketplaceScreen extends StatefulWidget {
  final void Function(String companyId) onSelect;

  const CompanyMarketplaceScreen({super.key, required this.onSelect});

  @override
  State<CompanyMarketplaceScreen> createState() => _CompanyMarketplaceScreenState();
}

class _CompanyMarketplaceScreenState extends State<CompanyMarketplaceScreen> {
  late final TechniciansRepository _repository;
  List<TechnicianCompanySummary>? _companies;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = TechniciansRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _repository.listActiveCompanies();
      if (mounted) setState(() => _companies = items);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('اختار الفريق/الشركة')),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Padding(padding: EdgeInsets.all(16), child: LoadingList(itemCount: 4));
    if (_error != null) {
      return Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: const TextStyle(color: Colors.red)));
    }
    if ((_companies ?? []).isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: EmptyState(
          icon: Icons.groups_outlined,
          title: 'مفيش شركات/فرق متاحة دلوقتي',
          description: 'جرّب "اختاروا لنا الأنسب" بدل كده',
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _companies!.map(_buildCard).toList(),
    );
  }

  Widget _buildCard(TechnicianCompanySummary company) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const CircleAvatar(radius: 24, child: Icon(Icons.groups_outlined)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(company.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 4),
                  Text('${company.staffCount} فني · ${company.branchCount} فرع', style: const TextStyle(color: Colors.grey)),
                ],
              ),
            ),
            FilledButton(
              onPressed: () => widget.onSelect(company.id),
              child: const Text('اختار'),
            ),
          ],
        ),
      ),
    );
  }
}
