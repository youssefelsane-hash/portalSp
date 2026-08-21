import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'preferred_crew_repository.dart';

// إدارة الفريق المفضّل الدائم (docs/08 §36.18، ADR-0022) — شبكة تفضيل نظير-لنظير مستقلة تمامًا
// عن RecruitTeamScreen (فريق طلب واحد مؤقت). الفني هنا بصفتين منفصلتين: owner (بيدعو زمايله
// ويشوف فريقه) وmember (بيوصله دعوات من فنيين تانيين، يقبل/يرفض/يسيب لاحقًا).
class PreferredCrewScreen extends StatefulWidget {
  const PreferredCrewScreen({super.key});

  @override
  State<PreferredCrewScreen> createState() => _PreferredCrewScreenState();
}

class _PreferredCrewScreenState extends State<PreferredCrewScreen> {
  late final PreferredCrewRepository _repository;
  final _codeController = TextEditingController();
  List<PreferredCrewMember>? _myCrew;
  List<PreferredCrewMember>? _invitations;
  List<PreferredCrewMember>? _memberships;
  String? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _repository = PreferredCrewRepository(context.read<AuthRepository>());
    _load();
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _repository.listMine(),
        _repository.listInvitationsReceived(),
        _repository.listMyMemberships(),
      ]);
      if (mounted) {
        setState(() {
          _myCrew = results[0];
          _invitations = results[1];
          _memberships = results[2];
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _invite() async {
    final code = _codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await _repository.invite(code);
      _codeController.clear();
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() {
      _acting = true;
      _error = null;
    });
    try {
      await action();
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
        appBar: AppBar(title: const Text('الفريق المفضّل')),
        body: RefreshIndicator(onRefresh: _load, child: _buildBody(context)),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_myCrew == null || _invitations == null || _memberships == null) {
      if (_error != null) {
        return ListView(
          children: [const SizedBox(height: 60), Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))],
        );
      }
      return const Padding(padding: EdgeInsets.all(16), child: LoadingList());
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_error != null) ...[
          Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          const SizedBox(height: 12),
        ],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('ادعُ زميل بكوده', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'زمايلك في الفريق المفضّل بيتعرضلهم فرصة تجنيد بأولوية أعلى (بعد فريقك الدائم) لما تحتاج تجنّد لطلب "اعتماد"، بلا موافقة إدارة.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _codeController,
                  decoration: const InputDecoration(labelText: 'كود الفني (مثال: TECH-000002)', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _acting ? null : _invite,
                  child: _acting
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('ابعت دعوة'),
                ),
              ],
            ),
          ),
        ),
        if (_invitations!.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text('دعوات وصلتك', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final invitation in _invitations!) ...[
            Card(
              child: ListTile(
                title: Text(invitation.fullName),
                subtitle: Text('كود: ${invitation.technicianCode}'),
                trailing: _acting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.check_circle_outline, color: Colors.green),
                            tooltip: 'قبول',
                            onPressed: () => _act(() => _repository.acceptInvitation(invitation.id)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.cancel_outlined, color: Colors.red),
                            tooltip: 'رفض',
                            onPressed: () => _act(() => _repository.declineInvitation(invitation.id)),
                          ),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ],
        const SizedBox(height: 20),
        Text('فريقي المفضّل', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (_myCrew!.isEmpty)
          const EmptyState(icon: Icons.groups_outlined, title: 'لسه محدش في فريقك المفضّل — ادعُ زميل بكوده فوق')
        else
          for (final member in _myCrew!) ...[
            Card(
              child: ListTile(
                title: Text(member.fullName),
                subtitle: Text(member.status == 'accepted' ? 'عضو — كود ${member.technicianCode}' : 'دعوة مبعوتة، مستنية رد'),
                trailing: _acting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : IconButton(
                        icon: const Icon(Icons.person_remove_outlined),
                        tooltip: 'إزالة',
                        onPressed: () => _act(() => _repository.removeMember(member.id)),
                      ),
              ),
            ),
            const SizedBox(height: 8),
          ],
        if (_memberships!.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text('أنا عضو في فريق مفضّل عند', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final membership in _memberships!) ...[
            Card(
              child: ListTile(
                title: Text(membership.fullName),
                subtitle: Text('كود: ${membership.technicianCode}'),
                trailing: _acting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : IconButton(
                        icon: const Icon(Icons.exit_to_app_outlined),
                        tooltip: 'اترك الفريق',
                        onPressed: () => _act(() => _repository.leave(membership.id)),
                      ),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }
}
