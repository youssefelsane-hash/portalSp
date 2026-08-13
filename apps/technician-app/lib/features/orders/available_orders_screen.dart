import 'package:flutter/material.dart';
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
import '../portfolio/portfolio_screen.dart';
import '../profile/profile_screen.dart';
import '../progression/progression_screen.dart';
import '../referrals/referral_screen.dart';
import '../schedule/schedule_screen.dart';
import 'models.dart';
import 'order_execution_screen.dart';
import 'orders_repository.dart';

class AvailableOrdersScreen extends StatefulWidget {
  const AvailableOrdersScreen({super.key});

  @override
  State<AvailableOrdersScreen> createState() => _AvailableOrdersScreenState();
}

class _AvailableOrdersScreenState extends State<AvailableOrdersScreen> {
  late final OrdersRepository _repository;
  List<AvailableOrder>? _orders;
  String? _error;
  bool _isActing = false;

  @override
  void initState() {
    super.initState();
    _repository = OrdersRepository(context.read<AuthRepository>());
    _recoverActiveOrThenLoad();
  }

  // كانت فجوة موثّقة: لو التطبيق اتقفل في نص دورة تنفيذ طلب، الشاشة الرئيسية كانت بترجع
  // بالضرورة لقايمة الطلبات المتاحة من غير أي أثر للطلب اللي كان شغال عليه. دلوقتي بتتحقق
  // الأول من GET /technician/orders/active وتفتح شاشة التنفيذ تلقائياً لو لقت طلب نشط.
  Future<void> _recoverActiveOrThenLoad() async {
    try {
      final activeOrder = await _repository.getActive();
      if (activeOrder != null && mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: activeOrder)),
        );
      }
    } on ApiException {
      // فشل فحص الاسترجاع مش لازم يمنع عرض قايمة الطلبات المتاحة العادية
    }
    await _load();
  }

  Future<void> _load() async {
    try {
      final orders = await _repository.fetchAvailable();
      if (mounted) setState(() => _orders = orders);
    } on ApiException catch (err) {
      if (mounted) setState(() => _error = err.message);
    }
  }

  Future<void> _accept(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      final acceptedOrder = await _repository.accept(order.orderId);
      if (mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => OrderExecutionScreen(initialOrder: acceptedOrder)),
        );
      }
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
    } finally {
      if (mounted) setState(() => _isActing = false);
    }
  }

  Future<void> _reject(AvailableOrder order) async {
    setState(() => _isActing = true);
    try {
      await _repository.reject(order.orderId);
      await _load();
    } on ApiException catch (err) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.message)));
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
                future: NotificationsRepository(context.read<AuthRepository>()).unreadCount(),
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
                      MaterialPageRoute(builder: (_) => const NotificationsScreen()),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _orders == null
                  ? const Padding(padding: EdgeInsets.all(16), child: LoadingList())
                  : _orders!.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 60),
                            Center(child: Text('أهلاً ${auth.user?.fullName ?? ''} 👋')),
                            const SizedBox(height: 12),
                            const EmptyState(icon: Icons.work_outline, title: 'مفيش طلبات متاحة دلوقتي'),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _orders!.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final order = _orders![index];
                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(order.serviceNameAr, style: Theme.of(context).textTheme.titleMedium),
                                    const SizedBox(height: 4),
                                    Text('${order.streetName}${order.landmark != null ? ' — ${order.landmark}' : ''}'),
                                    Text('على بعد ${order.distanceKm.toStringAsFixed(1)} كم'),
                                    if (order.problemDescription != null) Text(order.problemDescription!),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        FilledButton(
                                          onPressed: _isActing ? null : () => _accept(order),
                                          child: const Text('قبول'),
                                        ),
                                        const SizedBox(width: 8),
                                        OutlinedButton(
                                          onPressed: _isActing ? null : () => _reject(order),
                                          child: const Text('رفض'),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
        ),
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
                decoration: BoxDecoration(color: Theme.of(context).colorScheme.primaryContainer),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: Theme.of(context).colorScheme.primary,
                      child: Text(
                        (auth.user?.fullName ?? '؟').characters.first,
                        style: const TextStyle(color: Colors.white, fontSize: 20),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(auth.user?.fullName ?? '', style: Theme.of(context).textTheme.titleMedium),
                    Text('صُنّاع — الفني', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const _DrawerGroupLabel('الشغل'),
              _DrawerItem(
                icon: Icons.event_available_outlined,
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
              _DrawerItem(icon: Icons.person_outline, label: 'بروفايلي', builder: (_) => const ProfileScreen()),
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
              _DrawerItem(icon: Icons.insights_outlined, label: 'الأداء الشهري', builder: (_) => const KpiScreen()),
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
              _DrawerItem(icon: Icons.school_outlined, label: 'الأكاديمية', builder: (_) => const AcademyScreen()),
              _DrawerItem(
                icon: Icons.support_agent_outlined,
                label: 'تواصل مع الإدارة',
                builder: (_) => const InternalChatListScreen(),
              ),
              const Divider(height: 1),
              ListTile(
                leading: Icon(Icons.logout, color: Theme.of(context).colorScheme.error),
                title: Text('تسجيل الخروج', style: TextStyle(color: Theme.of(context).colorScheme.error)),
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
        style: Theme.of(context)
            .textTheme
            .labelMedium
            ?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.bold),
      ),
    );
  }
}

class _DrawerItem extends StatelessWidget {
  const _DrawerItem({required this.icon, required this.label, required this.builder});

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
