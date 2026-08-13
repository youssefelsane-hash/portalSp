import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_exception.dart';
import '../../core/auth_repository.dart';
import '../addresses/addresses_screen.dart';
import '../favorites/favorites_screen.dart';
import '../loyalty/loyalty_repository.dart';
import '../loyalty/loyalty_screen.dart';
import '../orders/orders_screen.dart';
import '../recurring/recurring_orders_screen.dart';
import '../referrals/referrals_screen.dart';
import '../technician_referral/technician_referral_screen.dart';

// حساب/سجل عميل موحّد (docs/08 §Retention) — كانت فجوة موثّقة صراحة: كل ميزة (طلبات، عناوين،
// ولاء، ترشيح، متكررة) كانت شغالة ومختبرة على حدة، بس متبعثرة في أيقونات AppBar منفصلة بلا أي
// نقطة تجميع واحدة — تجميع واجهة بحت (UX aggregation)، صفر backend جديد، كل البيانات جايه من
// repositories موجودة بالفعل.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  int? _loyaltyBalance;

  @override
  void initState() {
    super.initState();
    _loadLoyaltyBalance();
  }

  Future<void> _loadLoyaltyBalance() async {
    try {
      final balance = await LoyaltyRepository(context.read<AuthRepository>()).fetchBalance();
      if (mounted) setState(() => _loyaltyBalance = balance);
    } on ApiException {
      // فشل جلب الرصيد مش لازم يمنع باقي الشاشة من الظهور
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    final user = auth.user;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('حسابي')),
        body: ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const CircleAvatar(radius: 28, child: Icon(Icons.person, size: 28)),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.fullName ?? '', style: Theme.of(context).textTheme.titleLarge),
                        Text(user?.phoneNumber ?? '', style: Theme.of(context).textTheme.bodyMedium),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('طلباتي'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OrdersScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('عناويني'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddressesScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.favorite_border),
              title: const Text('المفضّلة'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const FavoritesScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.stars_outlined),
              title: const Text('نقاط الولاء'),
              subtitle: _loyaltyBalance != null ? Text('$_loyaltyBalance نقطة') : null,
              trailing: const Icon(Icons.chevron_left),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoyaltyScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.repeat),
              title: const Text('الطلبات المتكررة'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () =>
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RecurringOrdersScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.card_giftcard_outlined),
              title: const Text('رشّح صحابك'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ReferralsScreen())),
            ),
            ListTile(
              leading: const Icon(Icons.qr_code_scanner_outlined),
              title: const Text('عندك كود ترشيح فني؟'),
              trailing: const Icon(Icons.chevron_left),
              onTap: () =>
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TechnicianReferralScreen())),
            ),
            const Divider(height: 1),
            ListTile(
              leading: Icon(Icons.logout, color: Theme.of(context).colorScheme.error),
              title: Text('تسجيل الخروج', style: TextStyle(color: Theme.of(context).colorScheme.error)),
              onTap: () => context.read<AuthRepository>().logout(),
            ),
          ],
        ),
      ),
    );
  }
}
