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
  final List<Map<String, dynamic>> activity;
  final List<Map<String, dynamic>> comments;
  final Map<String, dynamic> summary;

  ProjectRoom({
    required this.project,
    required this.milestones,
    required this.quotes,
    required this.orders,
    required this.warranties,
    required this.activity,
    required this.comments,
    required this.summary,
  });

  factory ProjectRoom.fromJson(Map<String, dynamic> json) => ProjectRoom(
    project: json['project'] ?? {},
    milestones: (json['milestones'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
    quotes: (json['quotes'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
    orders: (json['orders'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
    warranties: (json['warranties'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
    activity: (json['activity'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
    comments: (json['comments'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>(),
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
    final data = await auth.authedRequest(
      'GET',
      '/me/projects/$projectId/room',
    );
    return ProjectRoom.fromJson(data!);
  }

  Future<void> approveQuote(String projectId, String quoteId) async {
    await auth.authedRequest(
      'POST',
      '/me/projects/$projectId/quotes/$quoteId/approve',
    );
  }

  // ADR-0036 / docs/08 §57 بند 3 — موافقة/رفض المرحلة الواحدة. الموافقة التلقائية شغّالة في
  // الباك-إند بعد مهلة، ودي المسار اليدوي للعميل اللي مش عايز يستنى.
  Future<void> approveMilestone(String projectId, String milestoneId) async {
    await auth.authedRequest(
      'POST',
      '/me/projects/$projectId/milestones/$milestoneId/approve',
    );
  }

  Future<void> rejectMilestone(
    String projectId,
    String milestoneId,
    String reason,
  ) async {
    await auth.authedRequest(
      'POST',
      '/me/projects/$projectId/milestones/$milestoneId/reject',
      body: {'reason': reason},
    );
  }

  Future<void> addComment(String projectId, String body) async {
    await auth.authedRequest(
      'POST',
      '/me/projects/$projectId/comments',
      body: {'body': body},
    );
  }
}

// ADR-0036 — حالة تنفيذ المرحلة بالعربي (كانت بتتعرض خام: pending/in_progress).
const milestoneExecutionLabelsAr = {
  'pending': 'لسه ما بدأتش',
  'in_progress': 'شغّالة دلوقتي',
  'completed': 'اتسلّمت — مستنية مراجعتك',
  'rejected': 'مرفوضة',
};

const milestoneApprovalLabelsAr = {
  'pending': 'مستنية موافقتك',
  'approved': 'وافقت عليها',
  'rejected': 'رفضتها',
};

/// شرح مختصر لكل تبويب (docs/08 §57 بند 2) — بلاغ المالك: "يلاقي في كل حاجة فيه شرح بسيط كده".
const projectTabHints = {
  'milestones':
      'المشروع مقسّم مراحل، كل مرحلة بسعرها. أول ما الإدارة تسلّم مرحلة هتقدر تراجعها وتوافق عليها من هنا.',
  'quotes':
      'عروض الأسعار اللي الإدارة بتبعتهالك. راجع التفاصيل ووافق على العرض المناسب.',
  'orders':
      'زيارات الفنيين المرتبطة بالمشروع ده — بتظهر هنا أول ما الإدارة تجدولها.',
  'warranties': 'الضمانات الصادرة على شغل المشروع، بمدتها وتاريخ انتهائها.',
  'activity':
      'كل حاجة حصلت في المشروع بالترتيب الزمني — سجل كامل تقدر ترجعله في أي وقت.',
};

const projectStatusLabelsAr = {
  'draft': 'مسودة',
  'survey_requested': 'طلب معاينة',
  'survey_scheduled': 'معاينة مجدولة',
  'quote_preparing': 'تحضير عرض',
  'awaiting_customer_approval': 'انتظار موافقتك',
  'awaiting_deposit': 'انتظار العربون',
  'active': 'نشط',
  'paused': 'متوقف',
  'awaiting_milestone_approval': 'انتظار موافقة مرحلة',
  'handover_pending': 'استلام نهائي',
  'completed': 'مكتمل',
  'cancelled': 'ملغي',
  'disputed': 'نزاع',
};

class ProjectRoomScreen extends StatefulWidget {
  final AuthRepository auth;
  final String projectId;
  const ProjectRoomScreen({
    super.key,
    required this.auth,
    required this.projectId,
  });

  @override
  State<ProjectRoomScreen> createState() => _ProjectRoomScreenState();
}

class _ProjectRoomScreenState extends State<ProjectRoomScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late final ProjectsRepository _repository = ProjectsRepository(widget.auth);
  ProjectRoom? _room;
  bool _loading = true;
  // قفل أثناء إرسال قرار المرحلة — يمنع دوسة مزدوجة على "وافق".
  bool _busy = false;
  bool _sendingComment = false;
  String? _error;
  final _commentController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final room = await _repository.room(widget.projectId);
      if (mounted) {
        setState(() {
          _room = room;
          _loading = false;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: DefaultTabController(
        length: 5,
        child: Scaffold(
          appBar: AppBar(
            title: Text(_room?.project['name_ar']?.toString() ?? 'المشروع'),
            bottom: TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'المراحل'),
                Tab(text: 'العروض'),
                Tab(text: 'الطلبات'),
                Tab(text: 'الضمانات'),
                Tab(text: 'التحديثات'),
              ],
            ),
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton.tonalIcon(
                          onPressed: () {
                            setState(() {
                              _loading = true;
                              _error = null;
                            });
                            _load();
                          },
                          icon: const Icon(Icons.refresh),
                          label: const Text('حاول تاني'),
                        ),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    _buildProjectOverview(),
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildMilestones(),
                          _buildQuotes(),
                          _buildOrders(),
                          _buildWarranties(),
                          _buildActivity(),
                        ],
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _buildProjectOverview() {
    final project = _room?.project ?? {};
    final status = project['status']?.toString() ?? '';
    final description = project['description_ar']?.toString().trim() ?? '';
    final budget = (project['budget_estimate_cents'] as num?)?.toInt();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(
          context,
        ).colorScheme.primaryContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  projectStatusLabelsAr[status] ?? status,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              Text(
                project['project_number']?.toString() ?? '',
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(description),
          ],
          if (budget != null) ...[
            const SizedBox(height: 6),
            Text(
              'ميزانيتك التقريبية: ${_egp(budget)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 6),
          Text(
            _nextStepLabel(status),
            style: TextStyle(color: Theme.of(context).colorScheme.primary),
          ),
        ],
      ),
    );
  }

  /// شريط شرح فوق كل تبويب (docs/08 §57 بند 2).
  Widget _tabHint(String key) => Container(
    width: double.infinity,
    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.info_outline, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            projectTabHints[key] ?? '',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    ),
  );

  /// المراحل (docs/08 §57 بند 3) — كانت بتعرض `approval_status` خام جنب المبلغ. بقت كارت كامل
  /// لكل مرحلة: حالة التنفيذ بالعربي، كومنتات الإدارة، وزراير الموافقة/الرفض لما تكون اتسلّمت.
  Widget _buildMilestones() {
    final ms = _room?.milestones ?? [];
    if (ms.isEmpty) {
      return Column(
        children: [
          _tabHint('milestones'),
          const Expanded(
            child: Center(child: Text('الإدارة لسه ما قسّمتش المشروع لمراحل')),
          ),
        ],
      );
    }
    return Column(
      children: [
        _tabHint('milestones'),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: ms.length,
            itemBuilder: (context, i) => _milestoneCard(ms[i]),
          ),
        ),
      ],
    );
  }

  Widget _milestoneCard(Map<String, dynamic> m) {
    final execution = m['execution_status']?.toString() ?? 'pending';
    final approval = m['approval_status']?.toString() ?? 'pending';
    final amountCents = ((m['amount_cents'] as num?) ?? 0).toInt();
    final rejection = m['rejection_reason']?.toString();
    final comments = (m['comments'] as List?) ?? const [];
    // زراير القرار بتبان بس لما الإدارة تسلّم المرحلة والعميل لسه ماردّش.
    final awaitingDecision = execution == 'completed' && approval == 'pending';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 14,
                  child: Text('${m['sequence_number']}'),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    m['name_ar']?.toString() ?? '',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Text(
                  _egp(amountCents),
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(
                    milestoneExecutionLabelsAr[execution] ?? execution,
                  ),
                ),
                if (execution == 'completed')
                  Chip(
                    visualDensity: VisualDensity.compact,
                    label: Text(
                      milestoneApprovalLabelsAr[approval] ?? approval,
                    ),
                  ),
              ],
            ),
            if (rejection != null && rejection.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                'سبب رفضك: $rejection',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            // كومنتات الإدارة المرئية بس — الباك-إند بيفلتر الداخلي في SQL (ADR-0036).
            if (comments.isNotEmpty) ...[
              const Divider(height: 20),
              Text(
                'تحديثات الإدارة',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 4),
              ...comments.map((raw) {
                final c = Map<String, dynamic>.from(raw as Map);
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Text(
                    '${c['author_name'] ?? 'الإدارة'}: ${c['body'] ?? ''}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                );
              }),
            ],
            if (awaitingDecision) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _decideMilestone(m['id'].toString(), true),
                      child: const Text('وافق على المرحلة'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => _decideMilestone(m['id'].toString(), false),
                      child: const Text('في ملاحظات'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _decideMilestone(String milestoneId, bool approve) async {
    String reason = '';
    if (!approve) {
      final controller = TextEditingController();
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('إيه الملاحظات على المرحلة دي؟'),
          content: TextField(
            controller: controller,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'اكتب المشكلة عشان الإدارة تعالجها',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                // راجع docs/08 §108-C — شيل الفوكس من حقل الملاحظات قبل الإقفال
                // عشان نتجنب Flutter assertion '_dependents.isEmpty' (شاشة حمرا).
                FocusScope.of(dialogContext).unfocus();
                Navigator.of(dialogContext).pop(false);
              },
              child: const Text('رجوع'),
            ),
            FilledButton(
              onPressed: () {
                FocusScope.of(dialogContext).unfocus();
                Navigator.of(dialogContext).pop(true);
              },
              child: const Text('إرسال'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      reason = controller.text.trim();
      if (reason.isEmpty) return;
    }

    setState(() => _busy = true);
    try {
      if (approve) {
        await _repository.approveMilestone(widget.projectId, milestoneId);
      } else {
        await _repository.rejectMilestone(
          widget.projectId,
          milestoneId,
          reason,
        );
      }
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            approve ? 'تمام، اتسجّلت موافقتك' : 'وصلت ملاحظاتك للإدارة',
          ),
        ),
      );
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(err.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _buildQuotes() {
    final quotes = _room?.quotes ?? [];
    if (quotes.isEmpty) return const Center(child: Text('مفيش عروض'));
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: quotes.length,
      itemBuilder: (context, i) {
        final q = quotes[i];
        final status = q['status']?.toString() ?? '';
        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: ExpansionTile(
            initiallyExpanded: i == 0,
            leading: Icon(
              status == 'approved'
                  ? Icons.check_circle
                  : Icons.description_outlined,
              color: status == 'approved' ? Colors.green : null,
            ),
            title: Text('عرض السعر v${q['version']}'),
            subtitle: Text(
              '${_egp(((q['total_cents'] as num?) ?? 0).toInt())} · ${_quoteStatusLabel(status)}',
            ),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              _quoteLines('الأعمال', q['work_lines']),
              _quoteLines('الخامات', q['material_lines']),
              _detailRow(
                'إجمالي الأعمال',
                _egp(((q['total_work_cents'] as num?) ?? 0).toInt()),
              ),
              _detailRow(
                'إجمالي الخامات',
                _egp(((q['total_materials_cents'] as num?) ?? 0).toInt()),
              ),
              if (q['duration_days'] != null)
                _detailRow('مدة التنفيذ', '${q['duration_days']} يوم'),
              if ((q['scope_included']?.toString().trim() ?? '').isNotEmpty)
                _detailRow('المشمول', q['scope_included'].toString()),
              if ((q['scope_excluded']?.toString().trim() ?? '').isNotEmpty)
                _detailRow('غير المشمول', q['scope_excluded'].toString()),
              if ((q['assumptions']?.toString().trim() ?? '').isNotEmpty)
                _detailRow('ملاحظات', q['assumptions'].toString()),
              if (q['sent_at'] != null)
                _detailRow(
                  'أرسل بواسطة',
                  '${q['created_by_name'] ?? 'الإدارة'} · ${_date(q['sent_at'])}',
                ),
              if (status == 'approved')
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    'تمت موافقتك على العرض بتاريخ ${_date(q['approved_at'])}',
                  ),
                ),
              if (status == 'sent') ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => _approveQuote(q['id'].toString()),
                    child: const Text('أوافق على عرض السعر'),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Future<void> _approveQuote(String quoteId) async {
    try {
      await ProjectsRepository(
        widget.auth,
      ).approveQuote(widget.projectId, quoteId);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'تم اعتماد عرض السعر، والإدارة تقدر تبدأ تجهيز المراحل الآن',
            ),
            backgroundColor: Colors.green,
          ),
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Widget _quoteLines(String title, dynamic rawLines) {
    final lines = rawLines is List ? rawLines : const [];
    if (lines.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          ...lines.map((raw) {
            final line = Map<String, dynamic>.from(raw as Map);
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      line['description_ar']?.toString() ?? '',
                      overflow: TextOverflow.ellipsis,
                      maxLines: 2,
                    ),
                  ),
                  const SizedBox(width: 6),
                  // docs/08 §108-H — بَقّة overflow منهجية: الوصف كان الجانب المرن الوحيد، لكن
                  // نص الكمية/الوحدة/السعر ده نص مُركّب (وحدة عربية طويلة + رقم كبير) وممكن
                  // يفيض هو نفسه لو طال. Flexible (مش Text عادي) بيخليه ينكمش بـ"..." كحل أخير
                  // بدل ما يفرض عرضه الكامل ويدفع الوصف لمساحة سالبة.
                  Flexible(
                    child: Text(
                      '${line['quantity']} ${line['unit'] ?? ''} × ${_egp(((line['unit_price_cents'] as num?) ?? 0).toInt())}',
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _detailRow(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 100,
          child: Text(label, style: const TextStyle(color: Colors.grey)),
        ),
        Expanded(child: Text(value)),
      ],
    ),
  );

  Widget _buildOrders() {
    final orders = _room?.orders ?? [];
    if (orders.isEmpty) {
      return Column(
        children: [
          _tabHint('orders'),
          const Expanded(
            child: Center(child: Text('لسه مفيش زيارات فنيين مجدولة للمشروع')),
          ),
        ],
      );
    }
    return Column(
      children: [
        _tabHint('orders'),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: orders.length,
            itemBuilder: (context, i) {
              final o = orders[i];
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(o['order_number']?.toString() ?? ''),
                  subtitle: Text(o['status']?.toString() ?? ''),
                  trailing: Text(
                    '${((o['total_amount_cents'] as num?) ?? 0) / 100} ج.م',
                  ),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          OrderDetailScreen(orderId: o['id'].toString()),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildWarranties() {
    final warranties = _room?.warranties ?? [];
    if (warranties.isEmpty) {
      // الضمان بيتصدر بعد اكتمال الشغل — الرسالة القديمة ("مفيش ضمانات") كانت بتسيب العميل
      // مش فاهم هل ده عطل ولا ترتيب طبيعي (docs/08 §57 بند 5).
      return Column(
        children: [
          _tabHint('warranties'),
          const Expanded(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'لسه مفيش ضمان صادر. الضمان بيتصدر بعد ما الشغل يكتمل ويتسلّم.',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
        ],
      );
    }
    return Column(
      children: [
        _tabHint('warranties'),
        Expanded(
          child: ListView.builder(
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
          ),
        ),
      ],
    );
  }

  Widget _buildActivity() {
    final activity = _room?.activity ?? [];
    final comments = _room?.comments ?? [];
    return Column(
      children: [
        _tabHint('activity'),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _commentController,
                  minLines: 1,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'اكتب رسالة للإدارة',
                    hintText: 'استفسار أو تحديث يخص المشروع…',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: _sendingComment ? null : _sendComment,
                tooltip: 'إرسال',
                icon: _sendingComment
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'رسائل المشروع',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 6),
              if (comments.isEmpty)
                const Text('مفيش رسائل لسه')
              else
                ...comments.map(
                  (comment) => Card(
                    child: ListTile(
                      leading: const CircleAvatar(
                        child: Icon(Icons.chat_bubble_outline, size: 18),
                      ),
                      title: Text(comment['body']?.toString() ?? ''),
                      subtitle: Text(
                        '${comment['author_name'] ?? 'الإدارة'} · ${_date(comment['created_at'])}',
                      ),
                    ),
                  ),
                ),
              const Divider(height: 28),
              Text(
                'سجل التنفيذ',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              if (activity.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('لسه مفيش نشاط مسجل'),
                )
              else
                ...activity.map(
                  (item) => ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.history, size: 18),
                    ),
                    title: Text(
                      _activityLabel(item['action']?.toString() ?? ''),
                    ),
                    subtitle: Text(
                      '${item['actor_name'] ?? 'النظام'} · ${_date(item['created_at'])}',
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _sendComment() async {
    final body = _commentController.text.trim();
    if (body.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('اكتب الرسالة الأول')));
      return;
    }
    setState(() => _sendingComment = true);
    try {
      await _repository.addComment(widget.projectId, body);
      _commentController.clear();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('وصلت رسالتك للإدارة')));
      }
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _sendingComment = false);
    }
  }
}

String _egp(int cents) =>
    '${(cents / 100).toStringAsFixed(cents % 100 == 0 ? 0 : 2)} ج.م';

String _date(dynamic value) {
  if (value == null) return '—';
  final parsed = DateTime.tryParse(value.toString())?.toLocal();
  if (parsed == null) return '—';
  return '${parsed.year}/${parsed.month.toString().padLeft(2, '0')}/${parsed.day.toString().padLeft(2, '0')} '
      '${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
}

String _quoteStatusLabel(String status) =>
    const {
      'draft': 'مسودة',
      'sent': 'بانتظار موافقتك',
      'approved': 'وافقت عليه',
      'rejected': 'مرفوض',
      'expired': 'منتهي',
      'superseded': 'تم استبداله',
    }[status] ??
    status;

String _nextStepLabel(String status) =>
    const {
      'survey_requested': 'الخطوة التالية: تتواصل معك الإدارة لتحديد المعاينة.',
      'survey_scheduled': 'الخطوة التالية: تنفيذ المعاينة وتجهيز عرض السعر.',
      'quote_preparing': 'الإدارة تجهز عرض السعر الآن.',
      'awaiting_customer_approval':
          'راجع تفاصيل عرض السعر في تبويب العروض ثم وافق عليه.',
      'awaiting_deposit':
          'تم اعتماد العرض. الإدارة تجهز مراحل التنفيذ والعربون.',
      'active': 'المشروع قيد التنفيذ.',
    }[status] ??
    'تابع التحديثات من سجل المشروع.';

String _activityLabel(String action) =>
    const {
      'project.created': 'أنشأ العميل المشروع',
      'project.survey_scheduled': 'حددت الإدارة المعاينة',
      'project.quote_preparing': 'بدأت الإدارة تجهيز العرض',
      'project.quote_created': 'أنشأت الإدارة عرض السعر',
      'project.quote_sent': 'أرسلت الإدارة عرض السعر',
      'project.quote_approved': 'وافق العميل على عرض السعر',
      'project.milestones_created': 'أنشأت الإدارة مراحل المشروع',
      'project.active': 'بدأ تنفيذ المشروع',
      'project.completed': 'اكتمل المشروع',
      'project.cancelled': 'تم إلغاء المشروع',
    }[action] ??
    action;
