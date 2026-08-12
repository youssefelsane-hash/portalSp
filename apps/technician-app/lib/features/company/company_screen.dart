import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
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
        Text('الفروع', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (detail.branches.isEmpty) const Text('مفيش فروع مضافة لسه'),
        for (final branch in detail.branches)
          Card(
            child: ListTile(
              title: Text(branch.name),
              subtitle: branch.addressLine != null ? Text(branch.addressLine!) : null,
              trailing: branch.isActive ? null : const Text('غير نشط'),
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
        Text('الأعضاء', style: Theme.of(context).textTheme.titleMedium),
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
                        } else {
                          _changeStaffRole(member, value);
                        }
                      },
                      itemBuilder: (context) => [
                        for (final role in assignableTeamRoles)
                          if (role != member.teamRole)
                            PopupMenuItem(value: role, child: Text('تغيير لـ ${teamRoleLabelsAr[role]}')),
                        const PopupMenuItem(value: 'remove', child: Text('إزالة من الفريق')),
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
