import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import 'project_room_screen.dart';
import 'create_project_screen.dart';

class ProjectModel {
  final String id;
  final String projectNumber;
  final String nameAr;
  final String projectType;
  final String status;

  ProjectModel({required this.id, required this.projectNumber, required this.nameAr, required this.projectType, required this.status});

  factory ProjectModel.fromJson(Map<String, dynamic> json) => ProjectModel(
    id: json['id'], projectNumber: json['project_number'], nameAr: json['name_ar'],
    projectType: json['project_type'], status: json['status'],
  );
}

const projectStatusLabelsAr = {
  'draft': 'مسودة', 'survey_requested': 'طلب معاينة', 'survey_scheduled': 'معاينة مجدولة',
  'quote_preparing': 'تحضير عرض', 'awaiting_customer_approval': 'انتظار موافقتك',
  'awaiting_deposit': 'انتظار العربون', 'active': 'نشط', 'paused': 'متوقف',
  'awaiting_milestone_approval': 'انتظار موافقة مرحلة', 'handover_pending': 'استلام نهائي',
  'completed': 'مكتمل', 'cancelled': 'ملغي', 'disputed': 'نزاع',
};

class ProjectsRepository {
  final AuthRepository auth;
  ProjectsRepository(this.auth);

  Future<List<ProjectModel>> list() async {
    final items = await auth.authedRequestList('/me/projects');
    return items.map(ProjectModel.fromJson).toList();
  }

  Future<ProjectModel> create({required String projectType, required String nameAr, String? description, required String addressId, int? budget}) async {
    final data = await auth.authedRequest('POST', '/me/projects', body: {
      'project_type': projectType, 'name_ar': nameAr,
      if (description != null) 'description_ar': description,
      'address_id': addressId,
      if (budget != null) 'budget_estimate_cents': budget,
    });
    return ProjectModel.fromJson(data!);
  }
}

class MyProjectsScreen extends StatefulWidget {
  const MyProjectsScreen({super.key});
  @override State<MyProjectsScreen> createState() => _MyProjectsScreenState();
}

class _MyProjectsScreenState extends State<MyProjectsScreen> {
  late final ProjectsRepository _repo;
  List<ProjectModel>? _projects;
  bool _loading = true;

  @override void initState() { super.initState(); _load(); }

  String? _error;

  Future<void> _load() async {
    if (!mounted) return;
    setState(() { _loading = true; _error = null; });
    try {
      final auth = context.read<AuthRepository>();
      _repo = ProjectsRepository(auth);
      final projects = await _repo.list().timeout(const Duration(seconds: 10));
      if (mounted) setState(() { _projects = projects; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.message; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = 'حصل خطأ، حاول تاني'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('مشاريعي')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(_error!, style: const TextStyle(color: Colors.red)),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: _load, child: const Text('حاول تاني')),
                  ]))
                : _projects == null || _projects!.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.home_work_outlined, size: 64, color: Theme.of(context).colorScheme.primary),
                          const SizedBox(height: 16),
                          Text('عندك شقة جديدة أو تجديد كبير؟',
                              style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 8),
                          Text('صوّر المكان واحكي لنا اللي محتاجه،\nوصُنّاع ترتب لك المعاينة والعرض والمراحل.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.grey)),
                          const SizedBox(height: 20),
                          FilledButton.icon(
                            icon: const Icon(Icons.add),
                            label: const Text('ابدأ مشروعك'),
                            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => CreateProjectScreen(auth: context.read<AuthRepository>()),
                            )),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _projects!.length,
                    itemBuilder: (context, i) {
                      final p = _projects![i];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 12),
                        child: ListTile(
                          title: Text(p.nameAr, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text('${p.projectNumber} · ${projectStatusLabelsAr[p.status] ?? p.status}'),
                          trailing: const Icon(Icons.chevron_left),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => ProjectRoomScreen(auth: context.read<AuthRepository>(), projectId: p.id),
                          )),
                        ),
                      );
                    },
                  ),
      ),
    );
  }
}
