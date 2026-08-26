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

// دالة اختيار موحّدة (docs/08 §38): إما فني فرد (id, isCompany:false) أو شركة (id, isCompany:true).
// الباراميتر التالت (ADR-0030 Slice D) بيحمل التاريخ الفعّال وقت الاختيار — ممكن يكون مختلف عن
// requestedAt الأصلي لو العميل جرّب "احجزه في المعاد ده بدلاً" على كارت متعارض جدوليًا.
typedef TechnicianOrCompanySelected = void Function(String id, bool isCompany, DateTime? effectiveRequestedAt);

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
  final TechnicianOrCompanySelected onSelect;
  final String? excludeTechnicianId;
  final Map<String, dynamic>? fieldValues;
  // "امتى تحب تنفّذ الشغل؟" (docs/08 §154) — بتتبعت لـGET /services/:id/technicians عشان
  // الأهلية المعروضة هنا تطابق فعليًا نفس منطق المطابقة الحقيقي (ADR-0017) لنفس تاريخ الطلب،
  // مش أهلية عامة "دلوقتي" ممكن متبقاش صحيحة وقت الموعد الفعلي.
  final DateTime? requestedAt;
  // توحيد فلو "اعتماد" مع "فردي" (docs/08 §38) — الشاشة دي بقت بتُستخدم للوضعين. team بيخلي
  // الباك-إند يفلتر مستوى الفني (محترف فأعلى) ويدمج الشركات في نفس القايمة.
  final BookingMode bookingMode;

  const TechnicianMarketplaceScreen({
    super.key,
    required this.service,
    required this.address,
    required this.onSelect,
    this.excludeTechnicianId,
    this.fieldValues,
    this.requestedAt,
    this.bookingMode = BookingMode.individual,
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
  // ADR-0030 Slice D — "احجزه في المعاد ده بدلاً" على كارت متعارض جدوليًا بيغيّر التاريخ الفعّال
  // هنا محليًا (بيعيد تحميل القايمة بيه) بدل ما يفتح شاشة جدولة منفصلة — نفس شاشة المقارنة،
  // بس بتاريخ جديد. لو العميل اختار فعلاً بعد كده، لازم CreateOrderScreen ياخد التاريخ الجديد ده
  // مش widget.requestedAt الأصلي، فبيتبعت مع onSelect.
  late DateTime? _effectiveRequestedAt;

  @override
  void initState() {
    super.initState();
    _effectiveRequestedAt = widget.requestedAt;
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
        scheduledAt: _effectiveRequestedAt,
        bookingMode: widget.bookingMode,
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

  void _tryNextAvailable(DateTime availableAgainAt) {
    setState(() {
      _effectiveRequestedAt = availableAgainAt;
      _technicians = null;
      _error = null;
    });
    _load();
  }

  void _select(String id, bool isCompany) => widget.onSelect(id, isCompany, _effectiveRequestedAt);

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.bookingMode == BookingMode.team
                ? 'اختار قائد/شركة: ${widget.service.nameAr}'
                : 'اختار الفني: ${widget.service.nameAr}',
          ),
        ),
        body: Column(
          children: [
            if (_effectiveRequestedAt != widget.requestedAt)
              Material(
                color: Theme.of(context).colorScheme.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      const Icon(Icons.event_available_outlined, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text('بتشوف الفنيين المتاحين في ${_formatDateTime(_effectiveRequestedAt!)}')),
                      TextButton(
                        onPressed: () {
                          setState(() {
                            _effectiveRequestedAt = widget.requestedAt;
                            _technicians = null;
                          });
                          _load();
                        },
                        child: const Text('رجوع للمعاد الأصلي'),
                      ),
                    ],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _technicians != null ? _countLabel(_technicians!) : ' ',
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
    if (t.isCompany) return _buildCompanyCard(t);
    final conflicted = t.isScheduleConflicted;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: conflicted ? Theme.of(context).colorScheme.surfaceContainerHighest : null,
      child: Opacity(
        opacity: conflicted ? 0.7 : 1,
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
                              padding: EdgeInsetsDirectional.only(start: 4),
                              child: TrustBadge(),
                            ),
                          Chip(
                            label: Text(technicianLevelLabelsAr[t.technicianLevel] ?? t.technicianLevel),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ],
                      ),
                      if (conflicted)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 6,
                            children: [
                              Chip(
                                avatar: const Icon(Icons.event_busy_outlined, size: 16),
                                label: const Text('مش متاح للفترة دي'),
                                visualDensity: VisualDensity.compact,
                                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                backgroundColor: Theme.of(context).colorScheme.errorContainer,
                              ),
                              if (t.unavailableReasonAr != null)
                                Text(t.unavailableReasonAr!, style: const TextStyle(fontSize: 12)),
                            ],
                          ),
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
                  // docs/08 §60.3 (طلب مالك صريح) — الفني اللي مستواه بيزوّد السعر لازم يبان
                  // جنبه إنه "مميّز"، عشان العميل يفهم الزيادة جاية منين بدل ما يحس إن السعر
                  // مرمي عشوائي. الشارة بتتحسب من level_price_multiplier اللي الباك-إند بيرجّعه
                  // أصلاً — مفيش أي حساب سعر في التطبيق (مصدر الحقيقة واحد).
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${(t.finalPriceCents! / 100).toStringAsFixed(0)} ج.م.',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      if ((t.levelPriceMultiplier ?? 1) > 1) const _PremiumBadge(),
                    ],
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
                    if (!conflicted)
                      FilledButton(
                        onPressed: () => _select(t.id, false),
                        child: const Text('اختار'),
                      )
                    else if (t.availableAgainAt != null)
                      FilledButton.tonal(
                        onPressed: () => _tryNextAvailable(t.availableAgainAt!),
                        child: Text('جرّب ${_formatDateTime(t.availableAgainAt!)}'),
                      ),
                  ],
                ),
              ],
            ),
            if (conflicted && t.availableAgainAt == null)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('معاد التوافر الجاي مش معروف دلوقتي', style: TextStyle(fontSize: 12, color: Colors.grey)),
              ),
          ],
        ),
        ),
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    final local = dt.toLocal();
    return '${local.day}/${local.month} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  String _countLabel(List<TechnicianBookingListItem> items) {
    final conflictedCount = items.where((t) => t.isScheduleConflicted).length;
    final availableCount = items.length - conflictedCount;
    if (conflictedCount == 0) return '$availableCount فني متاح';
    return '$availableCount متاح · $conflictedCount مش متاح للفترة دي';
  }

  // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38) — كارت مستقل عمداً بدل تعقيد _buildCard
  // بشروط كتير: مفيش مستوى ولا بروفايل فردي للشركة ككل.
  //
  // docs/08 §62.2 (طلب مالك صريح) — الشكل هنا مقصود إنه **يتقري كشركة من نظرة**، مش نسخة باهتة
  // من كارت الفرد: شريط علوي ملوّن باسم الشركة، إطار بلون الـprimary، وأرقام الشركة (عدد الفنيين/
  // الفروع/الشغل المكتمل) كشارات إحصائية بدل سطر نص واحد صغير. والسعر بقى بيظهر فعلاً — الشركة
  // بتتسعّر بالأساس (مضاعف مستوى = 1) وده حرفيًا اللي هيتحصّل، راجع catalog.controller.ts.
  Widget _buildCompanyCard(TechnicianBookingListItem c) {
    final scheme = Theme.of(context).colorScheme;
    final registered = c.isCommercialCompany;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.primary.withValues(alpha: 0.45), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // الشريط العلوي — ده اللي بيخلي الشركة "تتشاف" وسط كروت الأفراد.
          Container(
            color: scheme.primaryContainer,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(Icons.apartment, size: 20, color: scheme.onPrimaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    c.fullName,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: scheme.onPrimaryContainer,
                    ),
                  ),
                ),
                if (c.isVerified) const TrustBadge(),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _CompanyTag(
                      icon: registered ? Icons.business_center_outlined : Icons.groups_outlined,
                      // الفرق الحقيقي بين "شركة" و"فريق" في البيانات هو وجود سجل تجاري من عدمه
                      // (technician_companies.commercial_registration_number) — مش تسمية تجميلية.
                      label: registered ? 'شركة مسجّلة' : 'فريق عمل',
                      emphasized: true,
                    ),
                    _CompanyTag(icon: Icons.engineering_outlined, label: '${c.staffCount ?? 0} فني'),
                    if ((c.branchCount ?? 0) > 0)
                      _CompanyTag(icon: Icons.store_outlined, label: '${c.branchCount} فرع'),
                    if (c.completedOrdersCount > 0)
                      _CompanyTag(icon: Icons.task_alt, label: '${c.completedOrdersCount} طلب مكتمل'),
                    if (c.totalRatingsCount > 0)
                      _CompanyTag(
                        icon: Icons.star,
                        label: '${c.averageRating.toStringAsFixed(1)} (${c.totalRatingsCount})',
                      ),
                    if (c.distanceKm != null)
                      _CompanyTag(icon: Icons.place_outlined, label: '${c.distanceKm!.toStringAsFixed(1)} كم'),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'فريق كامل بيقدر يغطّي الشغل الكبير، ومسؤولية الشغل على الشركة نفسها.',
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    // docs/08 §65.2 — «سعر الشركة من غير فرق مستوى» كانت تعليمات داخلية بتشرح
                    // لينا إحنا ليه الشركة مالهاش مضاعف مستوى (§62.2)، مش معلومة تخصّ العميل.
                    // العميل بيشوف السعر وخلاص.
                    if (c.finalPriceCents != null)
                      Text(
                        '${(c.finalPriceCents! / 100).toStringAsFixed(0)} ج.م.',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                      )
                    else
                      const SizedBox.shrink(),
                    FilledButton(
                      onPressed: () => _select(c.id, true),
                      child: const Text('اختار الشركة'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// شارة إحصائية صغيرة داخل كارت الشركة (docs/08 §62.2).
class _CompanyTag extends StatelessWidget {
  const _CompanyTag({required this.icon, required this.label, this.emphasized = false});

  final IconData icon;
  final String label;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = emphasized ? scheme.onPrimary : scheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: emphasized ? scheme.primary : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: fg, fontWeight: emphasized ? FontWeight.w600 : FontWeight.normal),
          ),
        ],
      ),
    );
  }
}

/// علامة التوثيق الزرقاء (ADR-0039، docs/08 §62.1).
///
/// بتظهر بس لما الأدمن يمنحها صراحة — **مش** مشتقة من اعتماد أوراق الفني. لو ظهرت لكل حد
/// بتفقد معناها، وده بالظبط اللي المالك طلب إصلاحه.
class TrustBadge extends StatelessWidget {
  const TrustBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return const Tooltip(
      message: 'موثّق من المنصة',
      child: Icon(Icons.verified, size: 18, color: Color(0xFF1D9BF0)),
    );
  }
}

///
/// مقصودة تكون هادية وصغيرة: الهدف تفسير الفرق مش الإعلان. علامة الشيك بتدّي إحساس
/// "محترف معتمد" اللي المالك طلبه بالحرف.
/// شارة سعر أعلى من الأساسي (docs/08 §65.1).
///
/// طلب المالك: «إحنا مش عايزين علامة صح… نحط كلمة Premium وجنبها أي لوجو خفيف قوي يدل إن
/// premium دي هي رمز الفلوس… عايزين نشيل علامة الصح، لأن فعليًا علامة الصح المفروض دي توثيق
/// من الموقع وهي موجودة فعليًا والموقع بيديها لبعض الناس، فمش عايزين نخلي فيه حاجتين علامة صح
/// في نفس الوقت».
///
/// القاعدة الحاكمة دلوقتي: **`Icons.verified` محجوزة حصريًا لعلامة التوثيق اللي الأدمن بيمنحها**
/// (ADR-0039). أي إشارة تانية — زي السعر الأعلى ده — ممنوع تستخدم علامة صح، عشان العميل ما
/// يخلطش بين «موثّق من المنصة» و«سعره أعلى».
class _PremiumBadge extends StatelessWidget {
  const _PremiumBadge();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: scheme.tertiaryContainer,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.diamond_outlined, size: 11, color: scheme.onTertiaryContainer),
            const SizedBox(width: 3),
            Text(
              'Premium',
              style: TextStyle(
                fontSize: 11,
                color: scheme.onTertiaryContainer,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
