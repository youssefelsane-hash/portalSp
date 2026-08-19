import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/fallback_avatar.dart';
import '../../design/loading_list.dart';
import '../addresses/models.dart';
import '../catalog/models.dart';
import 'models.dart';
import 'technician_profile_screen.dart';
import 'technicians_repository.dart';

enum TechnicianSortOption { recommended, lowestPrice, highestRating }

extension on TechnicianSortOption {
  // ?sort= في GET /services/:id/technicians (Script 6 Part 8) — null (مش مبعوت خالص) يعني
  // recommended في الباك-إند، فمفيش قيمة صريحة ليها هنا.
  String? get apiValue => switch (this) {
        TechnicianSortOption.recommended => null,
        TechnicianSortOption.lowestPrice => 'lowest_price',
        TechnicianSortOption.highestRating => 'highest_rating',
      };
  String get labelAr => switch (this) {
        TechnicianSortOption.recommended => 'الأنسب',
        TechnicianSortOption.lowestPrice => 'الأقل سعرًا',
        TechnicianSortOption.highestRating => 'الأعلى تقييمًا',
      };
}

// Script 6 Part 6-8 — صفحة سوق مخصصة لمسار "اختار الفريق بنفسك"، منفصلة عن اختيار الوضع
// السريع (TechnicianSelectionScreen). كروت مقارنة ببيانات حقيقية بس من GET
// /services/:id/technicians (بلا أي رقم مصطنع — صورة/تقييم/طلبات مكتملة/توثيق/سعر نهائي/مسافة/
// التزام بالمواعيد كلهم من الباك-إند بالحرف). الفرز اليدوي (Part 8) منفصل عمداً عن ترتيب
// "الأنسب" الافتراضي (محرك التوصية البايزي في technicians.service.ts).
class TechnicianMarketplaceScreen extends StatefulWidget {
  final CatalogService service;
  final Address address;
  final void Function(String technicianId) onSelect;
  final String? excludeTechnicianId;
  final Map<String, dynamic>? fieldValues;

  const TechnicianMarketplaceScreen({
    super.key,
    required this.service,
    required this.address,
    required this.onSelect,
    this.excludeTechnicianId,
    this.fieldValues,
  });

  @override
  State<TechnicianMarketplaceScreen> createState() => _TechnicianMarketplaceScreenState();
}

class _TechnicianMarketplaceScreenState extends State<TechnicianMarketplaceScreen> {
  late final TechniciansRepository _repository;
  List<TechnicianBookingListItem>? _technicians;
  bool _loading = false;
  String? _error;
  TechnicianSortOption _sort = TechnicianSortOption.recommended;

  @override
  void initState() {
    super.initState();
    _repository = TechniciansRepository(context.read<AuthRepository>());
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final items = await _repository.listForService(
        widget.service.id,
        widget.address.id,
        excludeTechnicianId: widget.excludeTechnicianId,
        fieldValues: widget.fieldValues,
        sort: _sort.apiValue,
      );
      if (mounted) setState(() => _technicians = items);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onSortChanged(TechnicianSortOption? option) {
    if (option == null || option == _sort) return;
    setState(() {
      _sort = option;
      _technicians = null;
      _error = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: Text('اختار الفني: ${widget.service.nameAr}')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _technicians != null ? '${_technicians!.length} فني متاح' : ' ',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  DropdownButton<TechnicianSortOption>(
                    value: _sort,
                    underline: const SizedBox.shrink(),
                    items: TechnicianSortOption.values
                        .map((o) => DropdownMenuItem(value: o, child: Text(o.labelAr)))
                        .toList(),
                    onChanged: _onSortChanged,
                  ),
                ],
              ),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Padding(padding: EdgeInsets.all(16), child: LoadingList(itemCount: 4));
    if (_error != null) {
      return Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: const TextStyle(color: Colors.red)));
    }
    if ((_technicians ?? []).isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: EmptyState(
          icon: Icons.engineering_outlined,
          title: 'مفيش فنيين متاحين للخدمة دي في منطقتك دلوقتي',
          description: 'جرّب "اختاروا لي الأنسب" بدل كده',
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _technicians!.map(_buildCard).toList(),
    );
  }

  Widget _buildCard(TechnicianBookingListItem t) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FallbackAvatar(imageUrl: t.avatarUrl, radius: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(t.fullName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                          ),
                          if (t.isVerified)
                            const Padding(
                              padding: EdgeInsets.only(left: 4),
                              child: Tooltip(message: 'فني موثّق', child: Icon(Icons.verified, size: 18, color: Colors.blue)),
                            ),
                          Chip(
                            label: Text(technicianLevelLabelsAr[t.technicianLevel] ?? t.technicianLevel),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          if (t.totalRatingsCount > 0) ...[
                            const Icon(Icons.star, size: 14, color: Colors.amber),
                            Text(' ${t.averageRating.toStringAsFixed(1)} (${t.totalRatingsCount})  '),
                          ] else
                            const Text('لسه من غير تقييم  '),
                          Text('· ${t.completedOrdersCount} طلب مكتمل'),
                        ],
                      ),
                      if (t.distanceKm != null || t.avgArrivalMinutes != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Wrap(
                            spacing: 4,
                            children: [
                              if (t.distanceKm != null) ...[
                                const Icon(Icons.place_outlined, size: 14, color: Colors.grey),
                                Text('${t.distanceKm!.toStringAsFixed(1)} كم'),
                              ],
                              if (t.avgArrivalMinutes != null) ...[
                                const Icon(Icons.timer_outlined, size: 14, color: Colors.grey),
                                Text('وصول متوقع ~${t.avgArrivalMinutes} د'),
                              ],
                            ],
                          ),
                        ),
                      if (t.onTimeRatePercent != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            'التزام بالمواعيد: ${t.onTimeRatePercent}%',
                            style: const TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (t.finalPriceCents != null)
                  Text(
                    '${(t.finalPriceCents! / 100).toStringAsFixed(0)} ج.م.',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  )
                else
                  const SizedBox.shrink(),
                Wrap(
                  spacing: 8,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => TechnicianProfileScreen(technicianId: t.id)),
                      ),
                      child: const Text('البروفايل'),
                    ),
                    FilledButton(
                      onPressed: () => widget.onSelect(t.id),
                      child: const Text('اختار'),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
