import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'orders_repository.dart';

// تجنيد فريق ذاتي (docs/08 §31، طلب مالك صريح 2026-08-20) — قايمة مرشّحين من مجمع كل الفنيين
// المتاحين المؤهلين للصنعة (مش بس شركة القائد)، مرتّبين بالمسافة. دوس على واحد = تجنيد فوري بلا
// تأكيد تاني ("زي قبول تلقائي" — طلب المالك بالحرف)، مش فورم ولا انتظار موافقة من المُضاف.
class RecruitTeamScreen extends StatefulWidget {
  final String orderId;

  const RecruitTeamScreen({super.key, required this.orderId});

  @override
  State<RecruitTeamScreen> createState() => _RecruitTeamScreenState();
}

class _RecruitTeamScreenState extends State<RecruitTeamScreen> {
  late final OrdersRepository _repository;
  List<RecruitCandidate>? _candidates;
  String? _error;
  bool _recruiting = false;
  // آخر فني اتجنّد بنجاح — عشان الشاشة توضّح إن الطلب نجح قبل ما ترجع، مش تختفي فجأة بلا أي أثر.
  String? _lastRecruitedName;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final candidates = await _repository.fetchRecruitCandidates(widget.orderId);
      if (mounted) setState(() => _candidates = candidates);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _recruit(RecruitCandidate candidate) async {
    setState(() {
      _recruiting = true;
      _error = null;
    });
    try {
      await _repository.recruitTeamMember(widget.orderId, candidate.technicianId);
      if (mounted) setState(() => _lastRecruitedName = candidate.fullName);
      // بعد التجنيد الفوري، المرشّح ده بقى عضو فريق بالفعل — بنعيد التحميل عشان يختفي من القايمة
      // (استعلام listRecruitCandidates بيستبعد الأعضاء المضافين بالفعل تلقائيًا).
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _recruiting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('دعوة/ضم فريق')),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _buildBody(context),
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_error != null && _candidates == null) {
      return ListView(
        children: [
          const SizedBox(height: 60),
          Center(child: Text(_error!, style: const TextStyle(color: Colors.red))),
        ],
      );
    }
    if (_candidates == null) {
      return const Padding(padding: EdgeInsets.all(16), child: LoadingList());
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_lastRecruitedName != null) ...[
          Card(
            color: Theme.of(context).colorScheme.primaryContainer,
            child: ListTile(
              leading: const Icon(Icons.check_circle_outline),
              title: Text('اتضاف $_lastRecruitedName لفريق الطلب'),
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: Colors.red)),
          const SizedBox(height: 12),
        ],
        if (_candidates!.isEmpty)
          const EmptyState(
            icon: Icons.person_search_outlined,
            title: 'مفيش فنيين متاحين دلوقتي بنفس صنايعك في المنطقة دي',
          )
        else
          for (final candidate in _candidates!) ...[
            _RecruitCandidateCard(
              candidate: candidate,
              busy: _recruiting,
              onTap: () => _recruit(candidate),
            ),
            const SizedBox(height: 8),
          ],
      ],
    );
  }
}

class _RecruitCandidateCard extends StatelessWidget {
  const _RecruitCandidateCard({required this.candidate, required this.busy, required this.onTap});

  final RecruitCandidate candidate;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final distanceLabel = candidate.distanceKm != null ? '${candidate.distanceKm!.toStringAsFixed(1)} كم' : null;
    final levelLabel = technicianLevelLabelsAr[candidate.currentLevel] ?? candidate.currentLevel;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundImage: candidate.avatarUrl != null ? NetworkImage(candidate.avatarUrl!) : null,
          child: candidate.avatarUrl == null ? const Icon(Icons.person_outline) : null,
        ),
        title: Text(candidate.fullName),
        subtitle: Text(
          [
            levelLabel,
            'تقييم ${candidate.averageRating.toStringAsFixed(1)}',
            if (distanceLabel != null) distanceLabel,
          ].join(' — '),
        ),
        trailing: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.add_circle_outline),
        onTap: busy ? null : onTap,
      ),
    );
  }
}
