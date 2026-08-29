import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import 'kpi_repository.dart';
import 'models.dart';

const List<String> _monthNamesAr = [
  '',
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

// ملخّص أداء الفني الشهري (docs/11 §3) — المنصة بتعرض بس، الأدمن هو اللي قرر المبلغ النهائي.
// مفيش ملاحظات أدمن داخلية أو ترتيب بين الفنيين ظاهر هنا إلا لو الأدمن فعّل ده صراحة من الإعدادات.
class KpiScreen extends StatefulWidget {
  const KpiScreen({super.key});

  @override
  State<KpiScreen> createState() => _KpiScreenState();
}

class _KpiScreenState extends State<KpiScreen> {
  late final KpiRepository _repository;
  KpiTechnicianSummary? _summary;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = KpiRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final summary = await _repository.fetchSummary();
      if (mounted) {
        setState(() {
          _summary = summary;
          _error = null;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الأداء الشهري')),
        body: summary == null
            ? (_error != null
                  ? Center(child: Text(_error!))
                  : const Center(child: CircularProgressIndicator()))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (summary.latest == null)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: EmptyState(
                          icon: Icons.insights_outlined,
                          title: 'لسه مفيش تقييم أداء شهري متاح',
                          description:
                              'هيظهر هنا بعد ما الإدارة تحسب وتراجع تقرير الشهر',
                        ),
                      )
                    else ...[
                      _LatestCard(
                        snapshot: summary.latest!,
                        formatEgp: _formatEgp,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'سجل الشهور السابقة',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      for (final snapshot in summary.history.skip(1))
                        Card(
                          child: ListTile(
                            title: Text(
                              '${_monthNamesAr[snapshot.periodMonth]} ${snapshot.periodYear}',
                            ),
                            subtitle: Text(
                              kpiStatusLabelsAr[snapshot.status] ??
                                  snapshot.status,
                            ),
                            trailing: Text(
                              snapshot.approvedBonusCents != null
                                  ? _formatEgp(snapshot.approvedBonusCents!)
                                  : '—',
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

class _LatestCard extends StatelessWidget {
  final KpiSnapshot snapshot;
  final String Function(int) formatEgp;

  const _LatestCard({required this.snapshot, required this.formatEgp});

  @override
  Widget build(BuildContext context) {
    final dimensions = snapshot.dimensionScores;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${_monthNamesAr[snapshot.periodMonth]} ${snapshot.periodYear}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Center(
              child: Column(
                children: [
                  Text(
                    snapshot.overallScore?.toStringAsFixed(0) ?? '—',
                    style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Text('الدرجة الكلية من 100'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (!snapshot.isEligible && snapshot.ineligibilityReason != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  snapshot.ineligibilityReason!,
                  style: const TextStyle(color: Colors.orange),
                ),
              ),
            for (final entry in dimensions.entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(kpiDimensionLabelsAr[entry.key] ?? entry.key),
                    Text(
                      '${entry.value}',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'الحالة: ${kpiStatusLabelsAr[snapshot.status] ?? snapshot.status}',
                ),
                Text(
                  snapshot.approvedBonusCents != null
                      ? formatEgp(snapshot.approvedBonusCents!)
                      : (snapshot.suggestedBonusCents != null
                            ? '~${formatEgp(snapshot.suggestedBonusCents!)}'
                            : '—'),
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            if (snapshot.status == 'paid' && snapshot.paidAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'اتصرفت بتاريخ ${snapshot.paidAt!.substring(0, 10)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            if (snapshot.rejectedReason != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  snapshot.rejectedReason!,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
