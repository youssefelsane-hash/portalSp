import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../onboarding/onboarding_repository.dart';
import 'company_repository.dart';
import 'models.dart';

// شركتي/فريقي (docs/06 §3.8) — كانت فجوة موثّقة صراحة: كل الـAPI (إنشاء/فروع/أعضاء/نقل ملكية)
// كان موجود ومختبر حي في الباك-إند من زمان، بس مفيش أي شاشة في التطبيق كانت بتستخدمه خالص —
// فني عضو شركة/فريق مكانش يقدر يشوف زمايله أو يديرهم من جوّه التطبيق أصلاً.
class CompanyScreen extends StatefulWidget {
  const CompanyScreen({super.key});

  @override
  State<CompanyScreen> createState() => _CompanyScreenState();
}

class _CompanyScreenState extends State<CompanyScreen> {
  late final CompanyRepository _repository;
  late final OnboardingRepository _onboardingRepository;
  CompanyDetail? _detail;
  // مساحة عمل الشركة (ADR-0033) — null لحد ما تحميل الطلبات يخلص (لو فشل بيرجع [] بأمان، صفر
  // تأثير على باقي الشاشة اللي كانت شغالة من قبل).
  List<CompanyOrderSummary>? _orders;
  bool _notMember = false;
  String? _myTechnicianCode;
  String? _error;
  bool _loading = true;
  bool _acting = false;

  final _createNameController = TextEditingController();
  final _createCrController = TextEditingController();
  final _branchNameController = TextEditingController();
  final _branchAddressController = TextEditingController();
  final _staffCodeController = TextEditingController();
  String _staffRole = 'worker';

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthRepository>();
    _repository = CompanyRepository(auth);
    _onboardingRepository = OnboardingRepository(auth);
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final me = await _onboardingRepository.fetchMe();
      _myTechnicianCode = me.technicianCode;
      final detail = await _repository.fetchMine();
      if (mounted) setState(() => _detail = detail);
      // مساحة عمل الشركة — تحميل مستقل عمدًا (لا يعطّل عرض باقي تفاصيل الشركة لو فشل).
      _repository.fetchOrders().then((orders) {
        if (mounted) setState(() => _orders = orders);
      }).catchError((_) {
        if (mounted) setState(() => _orders = []);
      });
    } on ApiException catch (err) {
      if (err.statusCode == 404) {
        if (mounted) setState(() => _notMember = true);
      } else if (mounted) {
        setState(() => _error = err.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  StaffMember? get _myMembership {
    final detail = _detail;
    if (detail == null || _myTechnicianCode == null) return null;
    for (final member in detail.staff) {
      if (member.technicianCode == _myTechnicianCode) return member;
    }
    return null;
  }

  bool get _canManage {
    final role = _myMembership?.teamRole;
    return role == 'owner' || role == 'manager';
  }

  bool get _isOwner => _myMembership?.teamRole == 'owner';

  Future<void> _createCompany() async {
    final name = _createNameController.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.create(
        name: name,
        commercialRegistrationNumber: _createCrController.text.trim(),
      );
      setState(() => _notMember = false);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _addBranch() async {
    final name = _branchNameController.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.createBranch(name: name, addressLine: _branchAddressController.text.trim());
      _branchNameController.clear();
      _branchAddressController.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // تعديل فرع بعد إنشائه — كانت فجوة موثّقة صراحة (راجع تعليق updateBranch() في
  // company_repository.dart). نفس نمط _addBranch بالحرف، بس بيبدأ من قيم الفرع الحالية.
  Future<void> _editBranch(CompanyBranch branch) async {
    final nameController = TextEditingController(text: branch.name);
    final addressController = TextEditingController(text: branch.addressLine ?? '');
    var isActive = branch.isActive;
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('تعديل الفرع'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameController, decoration: const InputDecoration(labelText: 'اسم الفرع')),
                const SizedBox(height: 8),
                TextField(controller: addressController, decoration: const InputDecoration(labelText: 'العنوان (اختياري)')),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('نشط'),
                  value: isActive,
                  onChanged: (v) => setDialogState(() => isActive = v),
                ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('إلغاء')),
              FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('حفظ')),
            ],
          ),
        ),
      ),
    );
    if (result != true || !mounted) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.updateBranch(
        branch.id,
        name: nameController.text.trim(),
        addressLine: addressController.text.trim(),
        isActive: isActive,
      );
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _addStaff() async {
    final code = _staffCodeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.addStaff(technicianCode: code, teamRole: _staffRole);
      _staffCodeController.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _removeStaff(StaffMember member) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.removeStaff(member.userId);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _changeStaffRole(StaffMember member, String newRole) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.updateStaffRole(member.userId, newRole);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // §24 — كانت فجوة موثّقة: نقل الملكية موجود ومختبر بالباك-إند (المالك بس) بلا أي زرار في
  // الشاشة — المالك مالوش طريقة يسلّم الشركة لحد تاني غير API مباشر.
  Future<void> _transferOwnership(StaffMember newOwner) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نقل ملكية الشركة'),
        content: Text('متأكد إنك عايز تنقل ملكية الشركة/الفريق لـ ${newOwner.fullName}؟ الإجراء ده مش هينعمل تلقائيًا.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('إلغاء')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('تأكيد النقل')),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.transferOwnership(newOwner.userId);
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  String _formatOrderDate(DateTime at) {
    final two = (int n) => n.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)} — ${two(at.hour)}:${two(at.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('شركتي / فريقي')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _notMember
                  ? _buildCreateForm(context)
                  : _error != null && _detail == null
                      ? Center(child: Text(_error!))
                      : _detail == null
                          ? const SizedBox.shrink()
                          : _buildDetail(context, _detail!),
        ),
      ),
    );
  }

  Widget _buildCreateForm(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('لسه مش عضو في أي شركة/فريق', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        const Text('تقدر تنشئ شركة/فريق وتضيف زمايلك فيه — محتاج مستواك يكون مؤهل لقيادة فريق.'),
        const SizedBox(height: 16),
        TextField(
          controller: _createNameController,
          decoration: const InputDecoration(labelText: 'اسم الشركة/الفريق', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _createCrController,
          decoration: const InputDecoration(labelText: 'رقم السجل التجاري (اختياري)', border: OutlineInputBorder()),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _acting ? null : _createCompany,
          child: _acting
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('إنشاء'),
        ),
      ],
    );
  }

  Widget _buildSectionHeader(BuildContext context, IconData icon, String title) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(title, style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }

  // مساحة عمل الشركة (ADR-0033) — كروت إحصائيات سريعة ("عارف تفاصيل من الموقع والموقع بيفيده"،
  // طلب مالك صريح 2026-08-22). صفر endpoint إحصائيات منفصل عمدًا — كل حاجة محسوبة محليًا من
  // نفس قائمة _orders (تجميع models.dart's activeCompanyOrderStatuses).
  Widget _buildOrdersOverview(BuildContext context) {
    final orders = _orders;
    if (orders == null) {
      return const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: LinearProgressIndicator());
    }
    final activeCount = orders.where((o) => activeCompanyOrderStatuses.contains(o.orderStatus)).length;
    final completedCount = orders.where((o) => o.orderStatus == 'completed').length;
    final totalCents = orders.fold<int>(0, (sum, o) => sum + o.totalAmountCents);
    Widget stat(String label, String value) => Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
              child: Column(
                children: [
                  Text(value, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 2),
                  Text(label, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
                ],
              ),
            ),
          ),
        );
    return Row(
      children: [
        stat('إجمالي الطلبات', '${orders.length}'),
        const SizedBox(width: 8),
        stat('جارية دلوقتي', '$activeCount'),
        const SizedBox(width: 8),
        stat('مكتملة', '$completedCount'),
        const SizedBox(width: 8),
        stat('إجمالي القيمة', _formatEgp(totalCents)),
      ],
    );
  }

  Widget _buildOrdersSection(BuildContext context) {
    final orders = _orders;
    if (orders == null) return const SizedBox.shrink();
    if (orders.isEmpty) {
      return const EmptyState(icon: Icons.work_outline, title: 'مفيش طلبات اتعيّنت للشركة دي لسه');
    }
    return Column(
      children: [
        for (final order in orders)
          Card(
            child: ListTile(
              title: Text(order.serviceNameAr),
              subtitle: Text(
                [
                  order.orderNumber,
                  if (order.technicianName != null) order.technicianName!,
                  if (order.scheduledAt != null) _formatOrderDate(order.scheduledAt!),
                ].join(' — '),
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Chip(
                    label: Text(
                      orderStatusLabelsAr[order.orderStatus] ?? order.orderStatus,
                      style: const TextStyle(fontSize: 11),
                    ),
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  const SizedBox(height: 4),
                  Text(_formatEgp(order.totalAmountCents), style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildDetail(BuildContext context, CompanyDetail detail) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(detail.company.name, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 4),
                Chip(label: Text(teamRoleLabelsAr[_myMembership?.teamRole] ?? 'عضو')),
              ],
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        const SizedBox(height: 16),
        _buildOrdersOverview(context),
        const SizedBox(height: 24),
        _buildSectionHeader(context, Icons.work_outline, 'الشغل الجاري للشركة'),
        const SizedBox(height: 8),
        _buildOrdersSection(context),
        const SizedBox(height: 24),
        _buildSectionHeader(context, Icons.store_outlined, 'الفروع'),
        const SizedBox(height: 8),
        if (detail.branches.isEmpty) const EmptyState(icon: Icons.store_outlined, title: 'مفيش فروع مضافة لسه'),
        for (final branch in detail.branches)
          Card(
            child: ListTile(
              title: Text(branch.name),
              subtitle: branch.addressLine != null ? Text(branch.addressLine!) : null,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!branch.isActive) const Padding(padding: EdgeInsets.only(left: 8), child: Text('غير نشط')),
                  if (_canManage)
                    IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      tooltip: 'تعديل الفرع',
                      onPressed: _acting ? null : () => _editBranch(branch),
                    ),
                ],
              ),
            ),
          ),
        if (_canManage) ...[
          const SizedBox(height: 8),
          TextField(
            controller: _branchNameController,
            decoration: const InputDecoration(labelText: 'اسم فرع جديد', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _branchAddressController,
            decoration: const InputDecoration(labelText: 'العنوان (اختياري)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _acting ? null : _addBranch, child: const Text('إضافة فرع')),
        ],
        const SizedBox(height: 24),
        _buildSectionHeader(context, Icons.people_outline, 'الأعضاء'),
        const SizedBox(height: 8),
        for (final member in detail.staff)
          Card(
            child: ListTile(
              title: Text(member.fullName),
              subtitle: Text('${member.technicianCode} — ${teamRoleLabelsAr[member.teamRole] ?? member.teamRole}'),
              trailing: _canManage && member.teamRole != 'owner'
                  ? PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'remove') {
                          _removeStaff(member);
                        } else if (value == 'transfer_ownership') {
                          _transferOwnership(member);
                        } else {
                          _changeStaffRole(member, value);
                        }
                      },
                      itemBuilder: (context) => [
                        for (final role in assignableTeamRoles)
                          if (role != member.teamRole)
                            PopupMenuItem(value: role, child: Text('تغيير لـ ${teamRoleLabelsAr[role]}')),
                        const PopupMenuItem(value: 'remove', child: Text('إزالة من الفريق')),
                        if (_isOwner) const PopupMenuItem(value: 'transfer_ownership', child: Text('نقل الملكية له')),
                      ],
                    )
                  : null,
            ),
          ),
        if (_canManage) ...[
          const SizedBox(height: 8),
          TextField(
            controller: _staffCodeController,
            decoration: const InputDecoration(labelText: 'كود الفني المُضاف', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _staffRole,
            decoration: const InputDecoration(border: OutlineInputBorder()),
            items: [
              for (final role in assignableTeamRoles)
                DropdownMenuItem(value: role, child: Text(teamRoleLabelsAr[role] ?? role)),
            ],
            onChanged: (value) => setState(() => _staffRole = value ?? 'worker'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _acting ? null : _addStaff, child: const Text('إضافة عضو')),
        ],
      ],
    );
  }
}
