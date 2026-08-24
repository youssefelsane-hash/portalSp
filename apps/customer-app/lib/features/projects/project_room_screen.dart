import 'package:flutter/material.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../orders/order_detail_screen.dart';

class ProjectRoom {
  final Map<String, dynamic> project;
  final List<Map<String, dynamic>> milestones;
  final List<Map<String, dynamic>> quotes;
  final List<Map<String, dynamic>> orders;
  final List<Map<String, dynamic>> warranties;
  final Map<String, dynamic> summary;

  ProjectRoom({
    required this.project,
    required this.milestones,
    required this.quotes,
    required this.orders,
    required this.warranties,
    required this.summary,
  });

  factory ProjectRoom.fromJson(Map<String, dynamic> json) => ProjectRoom(
        project: json['project'] ?? {},
        milestones: (json['milestones'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>(),
        quotes: (json['quotes'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>(),
        orders: (json['orders'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>(),
        warranties: (json['warranties'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>(),
        summary: json['summary'] ?? {},
      );
}

class ProjectsRepository {
  final AuthRepository auth;
  ProjectsRepository(this.auth);

  Future<List<Map<String, dynamic>>> list() async {
    final items = await auth.authedRequestList('/me/projects');
    return items.cast<Map<String, dynamic>>();
  }

  Future<ProjectRoom> room(String projectId) async {
    final data = await auth.authedRequest('GET', '/me/projects/$projectId/room');
    return ProjectRoom.fromJson(data!);
  }

  Future<void> approveQuote(String projectId, String quoteId) async {
    await auth.authedRequest('POST', '/me/projects/$projectId/quotes/$quoteId/approve');
  }
}

const projectStatusLabelsAr = {
  'draft': 'مسودة', 'survey_requested': 'طلب معاينة', 'survey_scheduled': 'معاينة مجدولة',
  'quote_preparing': 'تحضير عرض', 'awaiting_customer_approval': 'انتظار موافقتك',
  'awaiting_deposit': 'انتظار العربون', 'active': 'نشط', 'paused': 'متوقف',
  'awaiting_milestone_approval': 'انتظار موافقة مرحلة', 'handover_pending': 'استلام نهائي',
  'completed': 'مكتمل', 'cancelled': 'ملغي', 'disputed': 'نزاع',
};

class ProjectRoomScreen extends StatefulWidget {
  final AuthRepository auth;
  final String projectId;
  const ProjectRoomScreen({super.key, required this.auth, required this.projectId});

  @override State<ProjectRoomScreen> createState() => _ProjectRoomScreenState();
}

class _ProjectRoomScreenState extends State<ProjectRoomScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  ProjectRoom? _room;
  bool _loading = true;
  String? _error;

  @override void initState() { super.initState(); _tabController = TabController(length: 4, vsync: this); _load(); }

  Future<void> _load() async {
    try {
      final repo = ProjectsRepository(widget.auth);
      final room = await repo.room(widget.projectId);
      if (mounted) setState(() { _room = room; _loading = false; });
    } on ApiException catch (error) {
      if (mounted) setState(() { _loading = false; _error = error.message; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: DefaultTabController(
        length: 4,
        child: Scaffold(
          appBar: AppBar(
            title: Text(_room?.project['name_ar']?.toString() ?? 'المشروع'),
            bottom: TabBar(controller: _tabController, tabs: const [
              Tab(text: 'المراحل'), Tab(text: 'العروض'), Tab(text: 'الطلبات'), Tab(text: 'الضمانات'),
            ]),
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(child: Text(_error!))
                  : TabBarView(controller: _tabController, children: [
                      _buildMilestones(), _buildQuotes(), _buildOrders(), _buildWarranties(),
                    ]),
        ),
      ),
    );
  }

  Widget _buildMilestones() {
    final ms = _room?.milestones ?? [];
    if (ms.isEmpty) return const Center(child: Text('مفيش مراحل'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: ms.length,
      itemBuilder: (context, i) {
        final m = ms[i];
        final status = m['approval_status']?.toString() ?? 'pending';
        final amount = ((m['amount_cents'] as num?) ?? 0) / 100;
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            leading: CircleAvatar(child: Text('${m['sequence_number']}')),
            title: Text(m['name_ar']?.toString() ?? ''),
            subtitle: Text('$amount ج.م · $status'),
            trailing: Icon(status == 'approved' ? Icons.check_circle : Icons.schedule,
                color: status == 'approved' ? Colors.green : Colors.grey),
          ),
        );
      },
    );
  }

  Widget _buildQuotes() {
    final quotes = _room?.quotes ?? [];
    if (quotes.isEmpty) return const Center(child: Text('مفيش عروض'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: quotes.length,
      itemBuilder: (context, i) {
        final q = quotes[i];
        final total = ((q['total_cents'] as num?) ?? 0) / 100;
        return Card(margin: const EdgeInsets.only(bottom: 8), child: ListTile(
          title: Text('عرض v${q['version']}'),
          subtitle: Text('$total ج.م · ${q['status']}'),
          trailing: q['status'] == 'sent'
              ? FilledButton(
                  onPressed: () async {
                    try {
                      await ProjectsRepository(widget.auth)
                          .approveQuote(widget.projectId, q['id'].toString());
                      await _load();
                    } on ApiException catch (error) {
                      if (mounted) {
                        ScaffoldMessenger.of(this.context)
                            .showSnackBar(SnackBar(content: Text(error.message)));
                      }
                    }
                  },
                  child: const Text('موافقة'),
                )
              : Icon(q['status'] == 'approved' ? Icons.check_circle : Icons.description,
                  color: q['status'] == 'approved' ? Colors.green : null),
        ));
      },
    );
  }

  Widget _buildOrders() {
    final orders = _room?.orders ?? [];
    if (orders.isEmpty) return const Center(child: Text('مفيش طلبات'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: orders.length,
      itemBuilder: (context, i) {
        final o = orders[i];
        return Card(margin: const EdgeInsets.only(bottom: 8), child: ListTile(
          title: Text(o['order_number']?.toString() ?? ''),
          subtitle: Text(o['status']?.toString() ?? ''),
          trailing: Text('${((o['total_amount_cents'] as num?) ?? 0) / 100} ج.م'),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => OrderDetailScreen(orderId: o['id'].toString()),
          )),
        ));
      },
    );
  }

  Widget _buildWarranties() {
    final warranties = _room?.warranties ?? [];
    if (warranties.isEmpty) return const Center(child: Text('مفيش ضمانات مرتبطة بالمشروع'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: warranties.length,
      itemBuilder: (context, index) {
        final warranty = warranties[index];
        return Card(
          child: ListTile(
            leading: const Icon(Icons.verified_user_outlined),
            title: Text(warranty['name_ar']?.toString() ?? 'ضمان'),
            subtitle: Text(
              'ساري حتى ${DateTime.parse(warranty['expires_at'].toString()).toLocal().toString().substring(0, 10)}',
            ),
          ),
        );
      },
    );
  }
}
