import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../academy/academy_screen.dart';
import '../assistant_offers/assistant_offers_screen.dart';
import '../earnings/wallet_screen.dart';
import '../internal_chat/internal_chat_list_screen.dart';
import '../company/company_screen.dart';
import '../notifications/notifications_repository.dart';
import '../notifications/notifications_screen.dart';
import '../portfolio/portfolio_screen.dart';
import '../profile/profile_screen.dart';
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
            IconButton(
              icon: const Icon(Icons.account_balance_wallet_outlined),
              tooltip: 'أرباحي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const WalletScreen()),
              ),
            ),
            // مطابقة المساعد التلقائية (ADR-0007) — فرص مساعدة على طلبات فنيين تانيين
            // (بث تنافسي، أول قبول صحيح ياخدها)، منفصلة عن قايمة "طلباتي المتاحة" فوق.
            IconButton(
              icon: const Icon(Icons.handshake_outlined),
              tooltip: 'فرص المساعدة',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AssistantOffersScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.event_available_outlined),
              tooltip: 'جدول مواعيدي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ScheduleScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.video_library_outlined),
              tooltip: 'معرض أعمالي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PortfolioScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.school_outlined),
              tooltip: 'الأكاديمية',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AcademyScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'تواصل مع الإدارة',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const InternalChatListScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.person_outline),
              tooltip: 'بروفايلي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ProfileScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.groups_outlined),
              tooltip: 'شركتي / فريقي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CompanyScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.qr_code_outlined),
              tooltip: 'ترشيح العملاء',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ReferralScreen()),
              ),
            ),
            IconButton(icon: const Icon(Icons.logout), onPressed: () => context.read<AuthRepository>().logout()),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: _error != null
              ? Center(child: Text(_error!))
              : _orders == null
                  ? const Center(child: CircularProgressIndicator())
                  : _orders!.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 120),
                            Center(child: Text('أهلاً ${auth.user?.fullName ?? ''} 👋')),
                            const SizedBox(height: 12),
                            const Center(child: Text('مفيش طلبات متاحة دلوقتي')),
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
