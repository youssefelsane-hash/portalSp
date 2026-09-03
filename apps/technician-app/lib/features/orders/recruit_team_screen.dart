import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import 'models.dart';
import 'orders_repository.dart';

// تجنيد فريق (docs/08 §31/§35، طلب مالك صريح 2026-08-20) — قايمة مرشّحين من مجمع كل الفنيين
// المتاحين المؤهلين للصنعة (فريق القائد الدائم أولاً — ADR-0021 §2)، مرتّبين بالمسافة. دوس على
// واحد = تجنيد فوري بلا تأكيد تاني لو LIGHT ("زي قبول تلقائي" — طلب المالك بالحرف)، أو فرصة
// اختيارية بتتبعتله لو MEANINGFUL/HEAVY (صفر تحميل صامت — ADR-0020).
class RecruitTeamScreen extends StatefulWidget {
  final String orderId;
  final String role; // 'technician' أو 'assistant'

  const RecruitTeamScreen({super.key, required this.orderId, required this.role});

  @override
  State<RecruitTeamScreen> createState() => _RecruitTeamScreenState();
}

class _RecruitTeamScreenState extends State<RecruitTeamScreen> {
  late final OrdersRepository _repository;
  List<RecruitCandidate>? _candidates;
  String? _error;
  bool _recruiting = false;
  // آخر نتيجة تجنيد — عشان الشاشة توضّح إن الطلب نجح (أو اتحوّل لفرصة اختيارية) قبل ما ترجع، مش تختفي فجأة بلا أي أثر.
  String? _lastOutcomeMessage;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final candidates = await _repository.fetchRecruitCandidates(widget.orderId, widget.role);
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
      final outcome = await _repository.recruitTeamMember(widget.orderId, candidate.technicianId, widget.role);
      if (mounted) {
        setState(() {
          _lastOutcomeMessage = outcome.isOfferSent
              ? 'اتبعتلـ${candidate.fullName} فرصة اختيارية — عنده شغل النهاردة، مستني رده'
              : 'اتضاف ${candidate.fullName} لفريق الطلب';
        });
      }
      // بعد التجنيد/الفرصة، المرشّح ده بقى عضو فريق أو عنده عرض حي بالفعل — بنعيد التحميل عشان
      // يختفي من القايمة (استعلام listRecruitCandidates بيستبعد الأعضاء المضافين تلقائيًا).
      await _load();
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _recruiting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final roleLabel = crewRoleLabelsAr[widget.role] ?? widget.role;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('دعوة/ضم $roleLabel')),
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
        if (_lastOutcomeMessage != null) ...[
          Card(
            color: Theme.of(context).colorScheme.primaryContainer,
            child: ListTile(
              leading: const Icon(Icons.check_circle_outline),
              title: Text(_lastOutcomeMessage!),
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
    final needsOffer = candidate.capacityTier == 'MEANINGFUL' || candidate.capacityTier == 'HEAVY';
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundImage: candidate.avatarUrl != null ? NetworkImage(candidate.avatarUrl!) : null,
          child: candidate.avatarUrl == null ? const Icon(Icons.person_outline) : null,
        ),
        title: Row(
          children: [
            Expanded(child: Text(candidate.fullName)),
            // أولوية فريق القائد الدائم (docs/08 §35 بند 2) — badge بصري واضح.
            if (candidate.isLeaderTeamMember)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text('فريقك', style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onPrimaryContainer)),
              )
            // أولوية الفريق المفضّل (docs/08 §36.17) — مستوى تاني بعد فريقك الدائم، بادج منفصل.
            else if (candidate.isPreferredCrewMember)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text('مفضّل', style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSecondaryContainer)),
              ),
          ],
        ),
        subtitle: Text(
          [
            levelLabel,
            'تقييم ${candidate.averageRating.toStringAsFixed(1)}',
            ?distanceLabel,
            if (needsOffer) 'عنده شغل النهاردة — هيتبعتله عرض بدل إضافة فورية',
          ].join(' — '),
        ),
        trailing: busy
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Icon(needsOffer ? Icons.send_outlined : Icons.add_circle_outline),
        onTap: busy ? null : onTap,
      ),
    );
  }
}
