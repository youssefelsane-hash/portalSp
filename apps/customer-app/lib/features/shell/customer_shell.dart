import 'package:flutter/material.dart';
import '../account/account_screen.dart';
import '../catalog/home_screen.dart';
import '../orders/orders_screen.dart';
import '../warranty/warranties_screen.dart';

/// التبويبات الأربعة للشريط السفلي (docs/08 §75-أ).
///
/// **ليه الأربعة دول بالذات؟** طلب المالك: «بدل Tasks نخليها طلباتي» و«ممكن كمان نزود جنبها
/// الضمانات». والاختيار محكوم بقاعدة تصميم واضحة: الشريط السفلي للوجهات اللي المستخدم بيرجعلها
/// **باستمرار**، مش لكل شاشة في التطبيق. الإشعارات والدعم بيفضلوا أيقونات في رأس الشاشة
/// الرئيسية — بيتفتحوا لما يحصل حاجة، مش وجهات دايمة.
///
/// أربعة هو السقف العملي: خمسة بتبدأ تضغط النصوص العربية وتخليها تتقص على شاشات الموبايل
/// الضيقة (اتقاس فعليًا، مش تقدير).
enum CustomerTab {
  home('الرئيسية', Icons.home_outlined, Icons.home_rounded),
  orders('طلباتي', Icons.receipt_long_outlined, Icons.receipt_long_rounded),
  warranties('ضماناتي', Icons.verified_user_outlined, Icons.verified_user_rounded),
  account('حسابي', Icons.person_outline_rounded, Icons.person_rounded);

  const CustomerTab(this.label, this.icon, this.selectedIcon);

  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// القشرة الرئيسية لتطبيق العميل — الشريط السفلي الدائم.
///
/// **قبل كده مكانش فيه شريط سفلي خالص**: التنقّل كله كان أيقونات مزحومة في الـAppBar (طلباتي،
/// إشعارات، دعم، حسابي — أربع أيقونات جنب بعض)، وده اللي كان مخلّي الشكل "عادي" زي ما المالك
/// وصفه. الشريط السفلي هو المعيار في كل تطبيقات الخدمات المعروفة لأنه بيخلّي الوجهات الأساسية
/// في متناول الإبهام وبيدّي إحساس دائم بمكانك في التطبيق.
///
/// **`IndexedStack` مش استبدال للودجت**: كل تبويب بيحتفظ بحالته (مكان الـscroll، البيانات
/// المحمّلة، نص البحث) لما تنتقل بينهم وترجع. من غيره كل رجوع للرئيسية كان هيعيد تحميل الكتالوج
/// من الصفر — وده بالظبط الإحساس "الرخيص" اللي بنحاول نتخلص منه.
class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key, this.initialTab = CustomerTab.home});

  final CustomerTab initialTab;

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> {
  late CustomerTab _current = widget.initialTab;

  /// التبويبات بتتبني كسول: تبويب ما اتفتحش لسه بيفضل `SizedBox.shrink()` بدل شاشة كاملة
  /// بتنادي الشبكة. من غير ده، فتح التطبيق كان هيشغّل أربع شاشات ونداءات API الأربعة مرة
  /// واحدة — تلاتة منهم المستخدم عمره ما شافهم في الجلسة دي.
  final Set<CustomerTab> _visited = {};

  @override
  void initState() {
    super.initState();
    _visited.add(_current);
  }

  void _select(int index) {
    final tab = CustomerTab.values[index];
    if (tab == _current) return;
    setState(() {
      _current = tab;
      _visited.add(tab);
    });
  }

  Widget _tabChild(CustomerTab tab) {
    if (!_visited.contains(tab)) return const SizedBox.shrink();
    switch (tab) {
      case CustomerTab.home:
        return const HomeScreen();
      case CustomerTab.orders:
        return const OrdersScreen();
      case CustomerTab.warranties:
        return const WarrantiesScreen();
      case CustomerTab.account:
        return const AccountScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: IndexedStack(
          index: _current.index,
          children: [for (final tab in CustomerTab.values) _tabChild(tab)],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _current.index,
          onDestinationSelected: _select,
          // ارتفاع أقل من الافتراضي (80) — الافتراضي بياخد مساحة كبيرة من شاشة الموبايل بلا
          // داعي، والنصوص العربية القصيرة دي مش محتاجاه.
          height: 68,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            for (final tab in CustomerTab.values)
              NavigationDestination(
                icon: Icon(tab.icon),
                selectedIcon: Icon(tab.selectedIcon),
                label: tab.label,
                tooltip: tab.label,
              ),
          ],
        ),
      ),
    );
  }
}
