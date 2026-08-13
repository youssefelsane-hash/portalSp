import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'models.dart';
import 'progression_repository.dart';

// المسار الوظيفي/الترقي (docs/11 §4) — الرتبة الحالية، التقدّم للمستوى الجاي، والمتطلبات
// الناقصة. الترقية الفعلية قرار أدمن (أو آلية لو المستوى ده مفعّل عليه ذلك) — الشاشة دي للعرض بس.
class ProgressionScreen extends StatefulWidget {
  const ProgressionScreen({super.key});

  @override
  State<ProgressionScreen> createState() => _ProgressionScreenState();
}

class _ProgressionScreenState extends State<ProgressionScreen> {
  late final ProgressionRepository _repository;
  ProgressionSummary? _summary;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = ProgressionRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final summary = await _repository.fetchSummary();
      if (mounted) setState(() => _summary = summary);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _levelLabel(String? level) => level == null ? '—' : (technicianLevelLabelsAr[level] ?? level);

  @override
  Widget build(BuildContext context) {
    final summary = _summary;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('المسار الوظيفي')),
        body: summary == null
            ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (summary.status == null)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 40),
                        child: Center(child: Text('لسه مفيش تقييم للمسار الوظيفي — استنى أول تقييم من الإدارة')),
                      )
                    else ...[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Center(
                                child: Column(
                                  children: [
                                    Text(_levelLabel(summary.status!.currentLevel), style: Theme.of(context).textTheme.headlineSmall),
                                    const Text('مستواك الحالي'),
                                  ],
                                ),
                              ),
                              if (summary.status!.nextLevel != null) ...[
                                const Divider(height: 32),
                                Text('التقدّم نحو "${_levelLabel(summary.status!.nextLevel)}"', style: Theme.of(context).textTheme.titleMedium),
                                const SizedBox(height: 12),
                                if (summary.status!.isEligible)
                                  const Text('مؤهّل للترقية — في انتظار موافقة الإدارة', style: TextStyle(color: Colors.green))
                                else
                                  for (final req in summary.status!.unmetRequirements)
                                    Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 4),
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Expanded(child: Text(req.labelAr)),
                                          Text('${req.currentValue ?? 0} / ${req.requiredValue}'),
                                        ],
                                      ),
                                    ),
                              ] else
                                const Padding(
                                  padding: EdgeInsets.only(top: 12),
                                  child: Text('وصلت لأعلى مستوى متاح حاليًا 🎉'),
                                ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text('سجل الترقيات', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      if (summary.history.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 16),
                          child: Text('لسه مفيش ترقيات مسجّلة'),
                        )
                      else
                        for (final entry in summary.history)
                          Card(
                            child: ListTile(
                              leading: const Icon(Icons.trending_up, color: Colors.green),
                              title: Text('${_levelLabel(entry.previousLevel)} ← ${_levelLabel(entry.newLevel)}'),
                              subtitle: Text(entry.effectiveFrom.substring(0, 10)),
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
