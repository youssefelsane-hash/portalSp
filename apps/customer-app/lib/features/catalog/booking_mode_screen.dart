import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../chat/chat_screen.dart';
import '../loyalty/loyalty_screen.dart';
import '../orders/orders_screen.dart';
import '../recurring/recurring_orders_screen.dart';
import '../referrals/referrals_screen.dart';
import 'categories_screen.dart';
import 'models.dart';

// هيكل الحجز الجديد (docs/06 §1، docs/07 الجزء أ) — أول شاشة بعد تسجيل الدخول. العميل بيختار
// "محتاج فرد ولا فريق؟" (+ طوارئ) قبل حتى ما يشوف الخدمات، بالظبط زي القرار المفضّل لصاحب
// المشروع (docs/06 §1.2 — "أنا شايف إن الأول أحسن"). الاختيار بيتمرر لـ CategoriesScreen وبعدين
// لـ ServicesScreen عشان يفلتر GET /services?booking_mode=... (allows_individual/allows_team/
// allows_emergency على كل خدمة، بدل قايمة كاتيجوريز منفصلة — راجع docs/07 لتفاصيل القرار).
class BookingModeScreen extends StatelessWidget {
  const BookingModeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('صُنّاع'),
          actions: [
            IconButton(
              icon: const Icon(Icons.receipt_long),
              tooltip: 'طلباتي',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const OrdersScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'الدعم',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ChatScreen.support()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.card_giftcard_outlined),
              tooltip: 'رشّح صحابك',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ReferralsScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.repeat),
              tooltip: 'الطلبات المتكررة',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const RecurringOrdersScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.stars_outlined),
              tooltip: 'نقاط الولاء',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const LoyaltyScreen()),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () => context.read<AuthRepository>().logout(),
            ),
          ],
        ),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('محتاج فرد ولا فريق؟', style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              _BookingModeCard(
                icon: Icons.person_outline,
                title: 'شغلانة سريعة',
                subtitle: 'حد يخلّصها بسرعة — صنايعي أو اتنين بالكتير',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CategoriesScreen(bookingMode: BookingMode.individual)),
                ),
              ),
              const SizedBox(height: 16),
              _BookingModeCard(
                icon: Icons.groups_outlined,
                title: 'اعتماد',
                subtitle: 'شغلانات كبيرة محتاجة فريق أو شركة كاملة',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CategoriesScreen(bookingMode: BookingMode.team)),
                ),
              ),
              const SizedBox(height: 16),
              _BookingModeCard(
                icon: Icons.bolt_outlined,
                title: 'طوارئ',
                subtitle: 'حجز فوري — استجابة أسرع بسعر مختلف',
                color: Colors.red,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CategoriesScreen(bookingMode: BookingMode.emergency)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BookingModeCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color? color;
  final VoidCallback onTap;

  const _BookingModeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final accent = color ?? Theme.of(context).colorScheme.primary;
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(backgroundColor: accent.withValues(alpha: 0.15), foregroundColor: accent, child: Icon(icon)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
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
