import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'complaint_detail_screen.dart';
import 'file_complaint_screen.dart';
import 'models.dart';
import 'support_repository.dart';

class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key});

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  late final SupportRepository _repository;
  List<Complaint>? _complaints;
  String? _error;

  @override
  void initState() {
    super.initState();
    _repository = SupportRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    try {
      final complaints = await _repository.listMine();
      if (mounted) setState(() => _complaints = complaints);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _openFileComplaint() async {
    final result = await Navigator.of(context).push<Complaint>(
      MaterialPageRoute(builder: (_) => const FileComplaintScreen()),
    );
    if (result != null) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('شكاويّي')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _openFileComplaint,
          icon: const Icon(Icons.add),
          label: const Text('شكوى جديدة'),
        ),
        body: _complaints == null
            ? (_error != null ? Center(child: Text(_error!)) : const Center(child: CircularProgressIndicator()))
            : _complaints!.isEmpty
                ? const Center(child: Text('مفيش شكاوى لسه'))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _complaints!.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final complaint = _complaints![i];
                        return ListTile(
                          title: Text(complaint.title),
                          subtitle: Text('#${complaint.complaintNumber} — ${complaintStatusLabelsAr[complaint.complaintStatus] ?? complaint.complaintStatus}'),
                          trailing: const Icon(Icons.chevron_left),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => ComplaintDetailScreen(complaintId: complaint.id)),
                          ),
                        );
                      },
                    ),
                  ),
      ),
    );
  }
}
