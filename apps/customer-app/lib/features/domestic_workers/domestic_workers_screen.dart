import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'domestic_workers_repository.dart';
import 'models.dart';
import 'worker_bookings_screen.dart';
import 'worker_detail_screen.dart';

// تصفّح مقدّمي الخدمات المنزلية (docs/08 §12, ADR-0004) — كانت فجوة موثّقة صراحة: الباك-إند
// (تصفّح/تفاصيل/حجز/إلغاء) شغال ومختبر حي من زمان بصفر شاشة في apps/customer-app تستخدمه.
class DomesticWorkersScreen extends StatefulWidget {
  const DomesticWorkersScreen({super.key});

  @override
  State<DomesticWorkersScreen> createState() => _DomesticWorkersScreenState();
}

class _DomesticWorkersScreenState extends State<DomesticWorkersScreen> {
  late final DomesticWorkersRepository _repository;
  List<PublicWorker>? _workers;
  String? _error;
  String? _selectedSpecialty;

  @override
  void initState() {
    super.initState();
    _repository = DomesticWorkersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final workers = await _repository.browse(specialty: _selectedSpecialty);
      if (mounted) setState(() => _workers = workers);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الخدمات المنزلية'),
          actions: [
            IconButton(
              icon: const Icon(Icons.event_note_outlined),
              tooltip: 'حجوزاتي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const WorkerBookingsScreen()),
              ),
            ),
          ],
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    ChoiceChip(
                      label: const Text('الكل'),
                      selected: _selectedSpecialty == null,
                      onSelected: (_) {
                        setState(() {
                          _selectedSpecialty = null;
                          _workers = null;
                        });
                        _load();
                      },
                    ),
                    const SizedBox(width: 8),
                    for (final entry in specialtyLabelsAr.entries)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: ChoiceChip(
                          label: Text(entry.value),
                          selected: _selectedSpecialty == entry.key,
                          onSelected: (_) {
                            setState(() {
                              _selectedSpecialty = entry.key;
                              _workers = null;
                            });
                            _load();
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _load,
                child: _error != null
                    ? Center(child: Text(_error!))
                    : _workers == null
                        ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                        : _workers!.isEmpty
                            ? ListView(
                                children: const [
                                  SizedBox(height: 80),
                                  EmptyState(icon: Icons.person_search_outlined, title: 'مفيش مقدّمين خدمة متاحين لهذا التخصص'),
                                ],
                              )
                            : ListView.builder(
                                padding: const EdgeInsets.all(16),
                                itemCount: _workers!.length,
                                itemBuilder: (context, index) {
                                  final worker = _workers![index];
                                  return Card(
                                    child: ListTile(
                                      onTap: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => WorkerDetailScreen(workerId: worker.id)),
                                      ),
                                      title: Text(worker.fullName),
                                      subtitle: Text(
                                        worker.specialties.map((s) => specialtyLabelsAr[s] ?? s).join(' · '),
                                      ),
                                      trailing: Column(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        crossAxisAlignment: CrossAxisAlignment.end,
                                        children: [
                                          Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              const Icon(Icons.star, size: 16, color: Colors.amber),
                                              Text(' ${worker.averageRating.toStringAsFixed(1)}'),
                                            ],
                                          ),
                                          if (worker.hourlyRateCents != null)
                                            Text('${_formatEgp(worker.hourlyRateCents!)}/ساعة'),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
