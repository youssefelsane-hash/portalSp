import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../academy/academy_screen.dart';
import '../assistant_offers/assistant_offers_screen.dart';
import '../earnings/wallet_screen.dart';
import '../internal_chat/internal_chat_list_screen.dart';
import '../company/company_screen.dart';
import '../kpi/kpi_screen.dart';
import '../notifications/notifications_repository.dart';
import '../notifications/notifications_screen.dart';
import '../onboarding/onboarding_repository.dart';
import '../portfolio/portfolio_screen.dart';
import '../profile/profile_screen.dart';
import '../progression/progression_screen.dart';
import '../referrals/referral_screen.dart';
import '../schedule/schedule_screen.dart';
import '../skills/skills_screen.dart';
import '../support/complaints_screen.dart';
import '../support/support_contact_screen.dart';
import 'models.dart';
import 'order.dart';
import 'order_execution_screen.dart';
import 'orders_repository.dart';

class AvailableOrdersScreen extends StatefulWidget {
  const AvailableOrdersScreen({super.key});

  @override
  State<AvailableOrdersScreen> createState() => _AvailableOrdersScreenState();
}

class _AvailableOrdersScreenState extends State<AvailableOrdersScreen> {
  late final OrdersRepository _repository;
  late final OnboardingRepository _onboardingRepository;
  List<AvailableOrder>? _orders;
  // ADR-0018 §10-11 — الشغل المجدول المؤكّد تلقائيًا (كان شاشة منفصلة في الـdrawer،
  // UpcomingConfirmedJobsScreen القديمة) والطلب النشط دلوقتي (كان بس auto-redirect وقت فتح
  // التطبيق، مفيش أثر ليه لو الفني رجع للشاشة الرئيسية بعد كده) بقوا جزء من نفس الشاشة الرئيسية.
  List<Order>? _upcomingOrders;
  // "شغلي كعضو فريق" (docs/08 §31، طلب مالك صريح 2026-08-20) — طلبات اتضاف ليها الفني كعضو فريق
  // (تجنيد ذاتي من قائد تاني)، مش هو قائدها. كانت بَقّة حقيقية: عضو الفريق معندوش أي طريقة يشوف
  // الطلب ده في تطبيقه خالص قبل كده (findOwnedByTechnicianOrThrow القديمة كانت بترفض 404 ليه).
  List<Order>? _teamAssignedOrders;
  Order? _activeOrder;
  String? _error;
  bool _isActing = false;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _onboardingRepository = OnboardingRepository(
      context.read<AuthRepository>(),
    );
    _recoverActiveOrThenLoad();
    _captureInitialLocation();
  }

  // بَقّة حقيقية اتلقطت (بلاغ المالك — سيناريو "يوسف"): current_location مالوش أي مسار شرعي
  // يتحدد بيه أول مرة قبل ما الفني ياخد طلب فعلي — matching.service.ts بيشترط current_location
  // IS NOT NULL صراحة، فالفني الجديد كان ميقدرش يتوصّله أي طلب أبدًا حتى لو مؤهّل تمامًا. بيتنادى
  // مرة واحدة (best-effort، صامت تمامًا — مفيش رسالة خطأ للمستخدم) أول ما الشاشة الرئيسية تفتح.
  // مش بديل عن تتبّع الموقع اللحظي وقت التنفيذ (order_execution_screen.dart's _shareLocation عبر
  // WebSocket) — ده بس أول قيمة تخلي الفني "قابل للتوزيع عليه" من الأساس.
  Future<void> _captureInitialLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      await _onboardingRepository.updateLocation(position.latitude, position.longitude);
    } catch (_) {
      // صامت عمدًا — أول ما الفني ياخد طلب فعلي، تتبّع التنفيذ اللحظي هيحدّث الموقع تاني.
    }
  }


  // كانت فجوة موثّقة: لو التطبيق اتقفل في نص دورة تنفيذ طلب، الشاشة الرئيسية كانت بترجع
  // بالضرورة لقايمة الطلبات المتاحة من غير أي أثر للطلب اللي كان شغال عليه. دلوقتي بتتحقق
  // الأول من GET /technician/orders/active وتفتح شاشة التنفيذ تلقائياً لو لقت طلب نشط.
  // **ADR-0018 §11**: بعد ما الفني يرجع من شاشة التنفيذ (رجع بالزرار، مش خلّص الطلب)، الطلب
  // النشط لازم يفضل ظاهر كـbanner بارز فوق الشاشة الرئيسية — مش يختفي تمامًا لحد إعادة فتح
  // التطبيق من الصفر. `_openActiveOrder()` تحت بتعمل نفس الشيء يدويًا لما الفني يدوس البانر.
  Future<void> _recoverActiveOrThenLoad() async {
    try {
      final activeOrder = await _repository.getActive();
      if (mounted) setState(() => _activeOrder = activeOrder);
      if (activeOrder != null && mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => OrderExecutionScreen(initialOrder: activeOrder),
          ),
        );
        await _refreshActiveOrder();
      }
    } on ApiException {
      // فشل فحص الاسترجاع مش لازم يمنع عرض قايمة الطلبات المتاحة العادية
    }
    await _load();
  }

  Future<void> _refreshActiveOrder() async {
    try {
      final activeOrder = await _repository.getActive();
      if (mounted) setState(() => _activeOrder = activeOrder);
    } on ApiException {
      // فشل صامت — البانر بس هيفضل بالقيمة القديمة لحد أول تحديث ناجح.
    }
  }

  Future<void> _openActiveOrder() async {
    final order = _activeOrder;
    if (order == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)),
    );
    await _refreshActiveOrder();
    await _load();
  }

  // ADR-0018 §10-11 — الشغل المؤكّد المجدول (بلا قرار قبول/رفض، فقط auto-confirm من الباك-إند)
  // بقى جزء من نفس تحميل الشاشة الرئيسية، مش endpoint منفصل شاشته منفصلة.
  Future<void> _load() async {
    try {
      final orders = await _repository.fetchAvailable();
      final upcoming = await _repository.fetchUpcomingConfirmed();
      if (mounted) {
        setState(() {
          _orders = orders;
          _upcomingOrders = upcoming;
        });
      }
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
    await _loadTeamAssigned();
  }

  // فشل التحميل (مشكلة شبكة عابرة) مايمنعش بقية الشاشة تشتغل — نفس فلسفة _loadTeamMembersIfApplicable
  // في order_execution_screen.dart بالحرف.
  Future<void> _loadTeamAssigned() async {
    try {
      final assigned = await _repository.fetchTeamAssigned();
      if (mounted) setState(() => _teamAssignedOrders = assigned);
    } catch (_) {
      // تجاهل — راجع التعليق فوق.
    }
  }

  Future<void> _accept(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      final acceptedOrder = await _repository.accept(order.orderId);
      if (mounted) {
        setState(() => _activeOrder = acceptedOrder);
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => OrderExecutionScreen(initialOrder: acceptedOrder),
          ),
        );
        await _refreshActiveOrder();
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  Future<void> _openUpcomingOrder(Order order) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)),
    );
    await _refreshActiveOrder();
    await _load();
  }

  Future<void> _openTeamAssignedOrder(Order order) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: order)),
    );
    await _load();
  }

  String _formatScheduledDay(String? iso) {
    if (iso == null) return '';
    final at = DateTime.parse(iso).toLocal();
    final now = DateTime.now();
    final startOfDay = DateTime(at.year, at.month, at.day);
    final startOfToday = DateTime(now.year, now.month, now.day);
    final diffDays = startOfDay.difference(startOfToday).inDays;
    final two = (int n) => n.toString().padLeft(2, '0');
    final dateLabel = '${two(at.day)}/${two(at.month)}/${at.year}';
    if (diffDays == 0) return 'النهاردة';
    if (diffDays == 1) return 'بكرة';
    return dateLabel;
  }

  Future<void> _reject(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      await _repository.reject(order.orderId);
      await _load();
    } on ApiException catch (err) {
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        // إصلاح ازدحام AppBar (docs/12 P1/P2 — كانت 12 IconButton متكدّسة فوق بعض على شاشة
        // موبايل ضيقة). الإشعارات (متكررة/حساسة للوقت، شارة عداد) فضلت في الـAppBar مباشرة —
        // كل حاجة تانية (ثانوية بطبيعتها) اتنقلت لـDrawer مجمّع منطقيًا، مركز الشاشة بقى فعليًا
        // "المهمة الحالية" (قايمة الطلبات المتاحة) زي ما الطلب الأصلي نص عليه بالحرف.
        drawer: const _TechnicianDrawer(),
        appBar: AppBar(
          title: const Text('صُنّاع — الفني'),
          actions: [
            // صندوق إشعارات داخل التطبيق (docs/08) — كانت فجوة موثّقة صراحة: الـendpoints
            // كانت شغالة ومختبرة من زمان بس مفيش شاشة كانت بتستخدمها خالص.
            Builder(
              builder: (context) => FutureBuilder<int>(
                future: NotificationsRepository(
                  context.read<AuthRepository>(),
                ).unreadCount(),
                builder: (context, snapshot) {
                  final unread = snapshot.data ?? 0;
                  return IconButton(
                    icon: Badge(
                      isLabelVisible: unread > 0,
                      label: Text('$unread'),
                      child: const Icon(Icons.notifications_outlined),
                    ),
                    tooltip: 'الإشعارات',
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const NotificationsScreen(),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                onRefresh: _load,
                child: _error != null
                    ? Center(child: Text(_error!))
                    : (_orders == null || _upcomingOrders == null)
                    ? const Padding(
                        padding: EdgeInsets.all(16),
                        child: LoadingList(),
                      )
                    : _buildHomeList(context, auth),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ADR-0018 §10-11 — الشاشة الرئيسية بقت قايمة واحدة موحّدة: الطلب النشط دلوقتي (لو موجود) فوق
  // كأبرز عنصر، بعده طلبات الطوارئ المعلّقة (محتاجة قبول/رفض صريح)، بعده الشغل المجدول المؤكّد
  // تلقائيًا (مرتّب بأقرب يوم أولًا — الباك-إند بيرجّعه ASC بالفعل). لو الثلاثة فاضيين، شاشة
  // ترحيبية فاضية زي ما كانت.
  Widget _buildHomeList(BuildContext context, AuthRepository auth) {
    final hasActive = _activeOrder != null;
    final pending = _orders ?? const <AvailableOrder>[];
    final upcoming = _upcomingOrders ?? const <Order>[];
    final teamAssigned = _teamAssignedOrders ?? const <Order>[];

    if (!hasActive && pending.isEmpty && upcoming.isEmpty && teamAssigned.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 60),
          Center(child: Text('أهلاً ${auth.user?.fullName ?? ''} 👋')),
          const SizedBox(height: 12),
          const EmptyState(
            icon: Icons.work_outline,
            title: 'مفيش شغل حالي — هيوصلك إشعار أول ما طلب يتوجّهلك',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (hasActive) ...[
          _ActiveOrderCard(order: _activeOrder!, onTap: _openActiveOrder),
          const SizedBox(height: 16),
        ],
        if (pending.isNotEmpty) ...[
          for (final order in pending) ...[
            _EmergencyRequestCard(
              order: order,
              busy: _isActing,
              onAccept: () => _accept(order),
              onReject: () => _reject(order),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
        ],
        if (upcoming.isNotEmpty) ...[
          Text(
            'الشغل المؤكّد قدامك',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          for (final order in upcoming) ...[
            _UpcomingJobCard(
              order: order,
              dayLabel: _formatScheduledDay(order.scheduledAt),
              onTap: () => _openUpcomingOrder(order),
            ),
            const SizedBox(height: 8),
          ],
        ],
        // "شغلي كعضو فريق" (docs/08 §31) — طلبات القائد التاني جنّده ليها، مش هو قائدها.
        if (teamAssigned.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            'شغلي كعضو فريق',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          for (final order in teamAssigned) ...[
            _TeamAssignedJobCard(order: order, onTap: () => _openTeamAssignedOrder(order)),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }
}

String _formatEgp(int cents) => '${(cents / 100).toStringAsFixed(0)} ج.م.';

// ADR-0018 §11 — الطلب النشط دلوقتي (اتقبل بالفعل، مش لسه محتاج قرار) لازم يفضل بارز وقابل
// لإعادة الفتح من الشاشة الرئيسية، مش يختفي تمامًا لحد ما التطبيق يتقفل ويترجع يتفتح من الصفر.
class _ActiveOrderCard extends StatelessWidget {
  const _ActiveOrderCard({required this.order, required this.onTap});

  final Order order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primaryContainer,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(Icons.play_circle_fill, color: scheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'الشغل الجاري دلوقتي',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: scheme.primary),
                    ),
                    const SizedBox(height: 4),
                    Text('طلب ${order.orderNumber}', style: Theme.of(context).textTheme.titleMedium),
                    Text(technicianOrderStatusLabelsAr[order.orderStatus] ?? order.orderStatus),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left),
            ],
          ),
        ),
      ),
    );
  }
}

// ADR-0018 §3-4-5 — العروض اللي بتوصل هنا كلها طوارئ بالتعريف بعد التصحيح (المجدول العادي بيتأكد
// تلقائيًا بلا قرار قبول/رفض، راجع _UpcomingJobCard تحت). "طلب قريب" القديمة كانت مضلّلة — مكانتش
// عن القرب الزمني، كانت فعليًا عن الاستعجال (طوارئ). العرض يفضل قابل للقبول طالما ظاهر في القايمة
// دي (§5) — مفيش عدّاد وقت مرئي هنا عمدًا عشان مانوهمش الفني إن العرض بيختفي بعد فترة معيّنة.
class _EmergencyRequestCard extends StatelessWidget {
  const _EmergencyRequestCard({
    required this.order,
    required this.busy,
    required this.onAccept,
    required this.onReject,
  });

  final AvailableOrder order;
  final bool busy;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.bolt, size: 16, color: Theme.of(context).colorScheme.error),
                const SizedBox(width: 4),
                Text(
                  'طلب طوارئ — محتاج قرارك دلوقتي',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.error,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(order.serviceNameAr, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('${order.streetName}${order.landmark != null ? ' — ${order.landmark}' : ''}'),
            Text('على بعد ${order.distanceKm.toStringAsFixed(1)} كم'),
            if (order.problemDescription != null) Text(order.problemDescription!),
            const SizedBox(height: 8),
            Row(
              children: [
                FilledButton(
                  onPressed: busy ? null : onAccept,
                  child: const Text('قبول'),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: busy ? null : onReject,
                  child: const Text('رفض'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ADR-0018 §10 — الشغل المجدول اتأكّد تلقائيًا بلا قرار قبول/رفض من الفني (autoConfirmScheduledOrder
// في الباك-إند) — بطاقة معلوماتية بس (فتح للتفاصيل)، بلا زراير قبول/رفض. الترتيب بأقرب يوم أولًا
// جاي من الباك-إند مباشرة (scheduled_at ASC)، فبكرة بتظهر فوق الشهر الجاي تلقائيًا.
class _UpcomingJobCard extends StatelessWidget {
  const _UpcomingJobCard({required this.order, required this.dayLabel, required this.onTap});

  final Order order;
  final String dayLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.event_available_outlined),
        title: Text('طلب ${order.orderNumber} — $dayLabel'),
        subtitle: Text(
          '${order.address != null ? order.address!.streetName : ''}'
          ' — ${_formatEgp(order.totalAmountCents)}',
        ),
        trailing: const Icon(Icons.chevron_left),
        onTap: onTap,
      ),
    );
  }
}

// "شغلي كعضو فريق" (docs/08 §31) — نفس شكل _UpcomingJobCard بالظبط، بس بيوضّح مين قائد الفريق
// اللي جنّده (team_leader_name، محسوبة في TechnicianOrderExecutionController.toDtoWithTeamInfo()).
class _TeamAssignedJobCard extends StatelessWidget {
  const _TeamAssignedJobCard({required this.order, required this.onTap});

  final Order order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.groups_outlined),
        title: Text('طلب ${order.orderNumber}'),
        subtitle: Text(
          order.teamLeaderName != null
              ? 'قائد الفريق: ${order.teamLeaderName} — ${_formatEgp(order.totalAmountCents)}'
              : _formatEgp(order.totalAmountCents),
        ),
        trailing: const Icon(Icons.chevron_left),
        onTap: onTap,
      ),
    );
  }
}

// Drawer التنقّل الثانوي (docs/12 P1/P2) — نفس فلسفة تجميع sidebar الأدمن (`app-shell.tsx`
// `NAV_GROUPS`) بمعادلها في Flutter: عناصر مبوّبة بعنوان مجموعة، مش قايمة أيقونات مسطّحة.
class _TechnicianDrawer extends StatelessWidget {
  const _TechnicianDrawer();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Drawer(
        child: SafeArea(
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              DrawerHeader(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: Theme.of(context).colorScheme.primary,
                      child: Text(
                        (auth.user?.fullName ?? '؟').characters.first,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      auth.user?.fullName ?? '',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      'صُنّاع — الفني',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const _DrawerGroupLabel('الشغل'),
              // "الشغل المؤكّد قدامي" بقى جزء من الشاشة الرئيسية مباشرة (ADR-0018 §10-11) — مفيش
              // شاشة درج منفصلة ليه دلوقتي.
              _DrawerItem(
                icon: Icons.calendar_month_outlined,
                label: 'جدول مواعيدي',
                builder: (_) => const ScheduleScreen(),
              ),
              // مطابقة المساعد التلقائية (ADR-0007) — فرص مساعدة على طلبات فنيين تانيين
              // (بث تنافسي، أول قبول صحيح ياخدها)، منفصلة عن قايمة "طلباتي المتاحة".
              _DrawerItem(
                icon: Icons.handshake_outlined,
                label: 'فرص المساعدة',
                builder: (_) => const AssistantOffersScreen(),
              ),
              _DrawerItem(
                icon: Icons.video_library_outlined,
                label: 'معرض أعمالي',
                builder: (_) => const PortfolioScreen(),
              ),
              const Divider(height: 1),
              const _DrawerGroupLabel('حسابي'),
              _DrawerItem(
                icon: Icons.person_outline,
                label: 'بروفايلي',
                builder: (_) => const ProfileScreen(),
              ),
              // تصريح مهارات ذاتي (Script 4 §2-7) — كانت فجوة موثّقة صراحة.
              _DrawerItem(
                icon: Icons.build_outlined,
                label: 'مهاراتي',
                builder: (_) => const SkillsScreen(),
              ),
              _DrawerItem(
                icon: Icons.groups_outlined,
                label: 'شركتي / فريقي',
                builder: (_) => const CompanyScreen(),
              ),
              _DrawerItem(
                icon: Icons.account_balance_wallet_outlined,
                label: 'أرباحي',
                builder: (_) => const WalletScreen(),
              ),
              _DrawerItem(
                icon: Icons.insights_outlined,
                label: 'الأداء الشهري',
                builder: (_) => const KpiScreen(),
              ),
              _DrawerItem(
                icon: Icons.military_tech_outlined,
                label: 'المسار الوظيفي',
                builder: (_) => const ProgressionScreen(),
              ),
              _DrawerItem(
                icon: Icons.qr_code_outlined,
                label: 'ترشيح العملاء',
                builder: (_) => const ReferralScreen(),
              ),
              const Divider(height: 1),
              const _DrawerGroupLabel('الدعم والتدريب'),
              _DrawerItem(
                icon: Icons.school_outlined,
                label: 'الأكاديمية',
                builder: (_) => const AcademyScreen(),
              ),
              // اتصال/واتساب مباشر مع خدمة العملاء (docs/08 §22 بند 15-19) — منفصل عن
              // "تواصل مع الإدارة" (شات داخلي) تحت.
              _DrawerItem(
                icon: Icons.call_outlined,
                label: 'اتصل بالدعم',
                builder: (_) => const SupportContactScreen(),
              ),
              _DrawerItem(
                icon: Icons.support_agent_outlined,
                label: 'تواصل مع الإدارة',
                builder: (_) => const InternalChatListScreen(),
              ),
              // §24 — كانت فجوة موثّقة: صفر شاشة شكاوى في التطبيق ده رغم إن الباك-إند بيعتبر
              // الفني طرف كامل في نظام الشكاوى من زمان.
              _DrawerItem(
                icon: Icons.report_problem_outlined,
                label: 'شكاويّي',
                builder: (_) => const ComplaintsScreen(),
              ),
              const Divider(height: 1),
              ListTile(
                leading: Icon(
                  Icons.logout,
                  color: Theme.of(context).colorScheme.error,
                ),
                title: Text(
                  'تسجيل الخروج',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                onTap: () {
                  Navigator.of(context).pop();
                  context.read<AuthRepository>().logout();
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}

class _DrawerGroupLabel extends StatelessWidget {
  const _DrawerGroupLabel(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: Theme.of(context).colorScheme.primary,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class _DrawerItem extends StatelessWidget {
  const _DrawerItem({
    required this.icon,
    required this.label,
    required this.builder,
  });

  final IconData icon;
  final String label;
  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(label),
      onTap: () {
        Navigator.of(context).pop();
        Navigator.of(context).push(MaterialPageRoute(builder: builder));
      },
    );
  }
}
