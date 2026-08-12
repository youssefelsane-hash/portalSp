import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../catalog/catalog_repository.dart';
import '../catalog/models.dart' show BookingMode;
import '../orders/create_order_screen.dart';
import 'models.dart';
import 'portfolio_link_viewer_screen.dart';
import 'technicians_repository.dart';

const Map<String, IconData> _platformIcons = {
  'tiktok': Icons.music_note,
  'youtube': Icons.smart_display_outlined,
  'instagram': Icons.camera_alt_outlined,
  'facebook': Icons.facebook,
};

class TechnicianProfileScreen extends StatefulWidget {
  final String technicianId;

  const TechnicianProfileScreen({super.key, required this.technicianId});

  @override
  State<TechnicianProfileScreen> createState() => _TechnicianProfileScreenState();
}

class _TechnicianProfileScreenState extends State<TechnicianProfileScreen> {
  late final TechniciansRepository _repository;
  final _catalogRepository = CatalogRepository();
  TechnicianPublicProfile? _profile;
  String? _error;
  bool _rebooking = false;
  // الجدولة الحقيقية للفني (docs/08 §2-§3) — كانت فجوة موثّقة صراحة: bookSlot() جاهز ومختبر في
  // الباك-إند بلا أي شاشة تستخدمه. فشل تحميل الجدول مش لازم يمنع باقي البروفايل من الظهور.
  List<ScheduleSlot> _scheduleSlots = [];
  bool _bookingSlot = false;

  @override
  void initState() {
    super.initState();
    _repository = TechniciansRepository(context.read<AuthRepository>());
    _load();
    _loadSchedule();
  }

  Future<void> _load() async {
    try {
      final profile = await _repository.fetchPublicProfile(widget.technicianId);
      if (mounted) setState(() => _profile = profile);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _loadSchedule() async {
    try {
      final slots = await _repository.fetchSchedule(widget.technicianId);
      if (mounted) setState(() => _scheduleSlots = slots);
    } on ApiException {
      // تجاهل — عرض السلوتات اختياري بحتة، العميل لسه يقدر يستخدم "إعادة الحجز" العادي
    }
  }

  String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

  Future<TechnicianServiceInfo?> _pickService(List<TechnicianServiceInfo> services) async {
    if (services.length == 1) return services.first;
    return showModalBottomSheet<TechnicianServiceInfo>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: services
                .map(
                  (s) => ListTile(
                    title: Text(s.nameAr),
                    trailing: Text(_formatEgp(s.basePriceCents)),
                    onTap: () => Navigator.of(context).pop(s),
                  ),
                )
                .toList(),
          ),
        ),
      ),
    );
  }

  Future<void> _rebook() async {
    final profile = _profile;
    if (profile == null || profile.services.isEmpty) return;
    final chosen = await _pickService(profile.services);
    if (chosen == null) return;

    setState(() => _rebooking = true);
    try {
      final service = await _catalogRepository.fetchService(chosen.id);
      if (mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            // "إعادة الحجز" — طلب نفس الفني بعينه دايماً وضع فردي (مش فريق/طوارئ).
            builder: (_) => CreateOrderScreen(
              service: service,
              bookingMode: BookingMode.individual,
              requestedTechnicianId: profile.id,
            ),
          ),
        );
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _rebooking = false);
    }
  }

  // الجدولة الحقيقية للفني (docs/08 §2-§3) — العميل بيحجز على سلوت `available` محدد بدل ما يسيب
  // المطابقة تختار. نفس تدفق _rebook() بالظبط بس scheduleSlotId بدل requestedTechnicianId.
  Future<void> _bookSlot(ScheduleSlot slot) async {
    final profile = _profile;
    if (profile == null || profile.services.isEmpty) return;
    final chosen = await _pickService(profile.services);
    if (chosen == null) return;

    setState(() => _bookingSlot = true);
    try {
      final service = await _catalogRepository.fetchService(chosen.id);
      if (mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CreateOrderScreen(
              service: service,
              bookingMode: BookingMode.individual,
              scheduleSlotId: slot.id,
            ),
          ),
        );
        // العميل ممكن يكون حجز السلوت أو رجع من غير ما يكمل — نعيد تحميل الجدول عشان يعكس
        // الحالة الحقيقية (السلوت بقى محجوز لو كمل، أو لسه فاضي لو رجع).
        await _loadSchedule();
      }
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _bookingSlot = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text(profile?.fullName ?? 'بروفايل الفني')),
        body: _error != null
            ? Center(child: Text(_error!))
            : profile == null
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Row(
                        children: [
                          CircleAvatar(
                            radius: 32,
                            backgroundImage: profile.avatarUrl != null ? NetworkImage(profile.avatarUrl!) : null,
                            child: profile.avatarUrl == null ? const Icon(Icons.person, size: 32) : null,
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(profile.fullName, style: Theme.of(context).textTheme.titleLarge),
                                    ),
                                    if (profile.isVerified) ...[
                                      const SizedBox(width: 6),
                                      const Icon(Icons.verified, color: Colors.blue, size: 20),
                                    ],
                                  ],
                                ),
                                Text(profile.technicianCode, style: Theme.of(context).textTheme.bodySmall),
                                if (profile.yearsOfExperience > 0)
                                  Text('${profile.yearsOfExperience} سنين خبرة'),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (profile.bio != null && profile.bio!.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text(profile.bio!),
                      ],
                      const SizedBox(height: 16),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _StatColumn(
                                icon: Icons.star,
                                label: 'التقييم',
                                value: profile.totalRatingsCount > 0
                                    ? '${profile.averageRating.toStringAsFixed(1)} (${profile.totalRatingsCount})'
                                    : 'لسه من غير تقييم',
                              ),
                              _StatColumn(
                                icon: Icons.check_circle_outline,
                                label: 'طلبات مكتملة',
                                value: '${profile.completedOrdersCount}',
                              ),
                              _StatColumn(
                                icon: Icons.event_available_outlined,
                                label: 'الالتزام بالمواعيد',
                                value: profile.onTimeRate != null ? '${profile.onTimeRate}%' : '—',
                              ),
                              _StatColumn(
                                icon: Icons.cancel_outlined,
                                label: 'معدل الإلغاء',
                                value: profile.cancellationRate != null ? '${profile.cancellationRate}%' : '—',
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (profile.zones.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('مناطق العمل', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          children: profile.zones.map((z) => Chip(label: Text(z.nameAr))).toList(),
                        ),
                      ],
                      if (profile.services.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('الخدمات', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        for (final s in profile.services)
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(s.nameAr),
                            trailing: Text(_formatEgp(s.basePriceCents)),
                          ),
                      ],
                      if (_scheduleSlots.any((s) => s.isAvailable)) ...[
                        const SizedBox(height: 16),
                        Text('مواعيد فاضية', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Card(
                          child: Column(
                            children: _scheduleSlots
                                .where((s) => s.isAvailable)
                                .map(
                                  (slot) => ListTile(
                                    leading: const Icon(Icons.event_available_outlined),
                                    title: Text(slot.slotDate),
                                    subtitle: Text('${slot.startTime.substring(0, 5)} - ${slot.endTime.substring(0, 5)}'),
                                    trailing: _bookingSlot
                                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                        : const Icon(Icons.chevron_left),
                                    onTap: _bookingSlot ? null : () => _bookSlot(slot),
                                  ),
                                )
                                .toList(),
                          ),
                        ),
                      ],
                      if (profile.portfolioLinks.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('معرض الأعمال', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 120,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: profile.portfolioLinks.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 8),
                            itemBuilder: (context, index) {
                              final link = profile.portfolioLinks[index];
                              return InkWell(
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => PortfolioLinkViewerScreen(link: link)),
                                ),
                                child: Container(
                                  width: 90,
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(8),
                                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                                    image: link.thumbnailUrl != null
                                        ? DecorationImage(image: NetworkImage(link.thumbnailUrl!), fit: BoxFit.cover)
                                        : null,
                                  ),
                                  child: link.thumbnailUrl == null
                                      ? Column(
                                          mainAxisAlignment: MainAxisAlignment.center,
                                          children: [
                                            Icon(
                                              _platformIcons[link.platform] ?? Icons.play_circle_outline,
                                              size: 32,
                                            ),
                                            const SizedBox(height: 4),
                                            const Icon(Icons.play_arrow, size: 20),
                                          ],
                                        )
                                      : const Align(
                                          alignment: Alignment.center,
                                          child: Icon(Icons.play_circle_fill, color: Colors.white, size: 32),
                                        ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                      if (profile.recentReviews.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('آخر التقييمات', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        for (final r in profile.recentReviews)
                          Card(
                            margin: const EdgeInsets.only(bottom: 8),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: List.generate(
                                      5,
                                      (i) => Icon(
                                        i < r.overallRating ? Icons.star : Icons.star_border,
                                        size: 16,
                                        color: Colors.amber,
                                      ),
                                    ),
                                  ),
                                  if (r.comment != null) ...[
                                    const SizedBox(height: 4),
                                    Text(r.comment!),
                                  ],
                                ],
                              ),
                            ),
                          ),
                      ],
                      const SizedBox(height: 24),
                      if (profile.services.isNotEmpty)
                        FilledButton.icon(
                          onPressed: _rebooking ? null : _rebook,
                          icon: _rebooking
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.replay),
                          label: const Text('إعادة الحجز مع نفس الفني'),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class _StatColumn extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _StatColumn({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 4),
        Text(value, style: Theme.of(context).textTheme.titleSmall),
        Text(label, style: Theme.of(context).textTheme.labelSmall, textAlign: TextAlign.center),
      ],
    );
  }
}
