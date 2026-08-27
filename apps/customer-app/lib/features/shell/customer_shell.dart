import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_gate.dart';
import '../../core/auth_repository.dart';
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
  home('الرئيسية', Icons.home_outlined, Icons.home_rounded, requiresAccount: false),
  orders('طلباتي', Icons.receipt_long_outlined, Icons.receipt_long_rounded),
  warranties('ضماناتي', Icons.verified_user_outlined, Icons.verified_user_rounded),
  account('حسابي', Icons.person_outline_rounded, Icons.person_rounded);

  const CustomerTab(
    this.label,
    this.icon,
    this.selectedIcon, {
    this.requiresAccount = true,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;

  /// التبويب ده محتاج حساب؟ (docs/08 §77-B1)
  ///
  /// الرئيسية بس هي اللي بتشتغل للزائر — الكتالوج `@Public()` في الباك-إند. الباقي **بيانات
  /// شخصية بحتة** (طلباتي، ضماناتي، حسابي): بلا حساب مفيش حاجة تتعرض أصلاً. من غير العلم ده،
  /// التبويبات دي كانت هتنادي endpoints محمية وتفشل بـ401 وتعرض «حصل خطأ» — رسالة غلط تمامًا
  /// لموقف مفهوم تمامًا.
  final bool requiresAccount;
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
    // زائر فتح تبويب محتاج حساب — دعوة مفهومة بدل شاشة بتفشل بـ401.
    if (tab.requiresAccount && !context.watch<AuthRepository>().isAuthenticated) {
      return _GuestTabInvitation(tab: tab);
    }
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

/// اللي الزائر بيشوفه في تبويب محتاج حساب (docs/08 §77-B1).
///
/// **ليه دعوة مخصّصة لكل تبويب مش رسالة واحدة عامة؟** لأن السبب مختلف فعلاً: «طلباتي» فاضية
/// لأن مفيش طلبات، و«ضماناتي» فاضية لأن مفيش شغل اتعمل. رسالة واحدة عامة («سجّل دخول») بتقول
/// للعميل إنه ممنوع، والرسالة دي بتقوله إن مفيش حاجة تتعرض **لسه**.
class _GuestTabInvitation extends StatelessWidget {
  const _GuestTabInvitation({required this.tab});

  final CustomerTab tab;

  ({IconData icon, String title, String body}) get _content => switch (tab) {
        CustomerTab.orders => (
            icon: Icons.receipt_long_outlined,
            title: 'طلباتك هتظهر هنا',
            body: 'أول ما تحجز أول شغلانة، هتلاقي هنا حالتها والفني والسعر — كل حاجة في مكان واحد.',
          ),
        CustomerTab.warranties => (
            icon: Icons.verified_user_outlined,
            title: 'ضمانات شغلك هتظهر هنا',
            body: 'كل شغلانة بتخلص بيتسجّل ليها ضمان. لو ظهر أي عيب جوّه المدة، بتفتح مطالبة من هنا.',
          ),
        _ => (
            icon: Icons.person_outline_rounded,
            title: 'حسابك',
            body: 'عناوينك، محفظتك، ونقاطك — كلها بتتحفظ هنا أول ما تعمل حساب.',
          ),
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = _content;
    return Scaffold(
      appBar: AppBar(title: Text(tab.label)),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: theme.colorScheme.primaryContainer,
                ),
                child: Icon(content.icon, size: 40, color: theme.colorScheme.onPrimaryContainer),
              ),
              const SizedBox(height: 20),
              Text(
                content.title,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                content.body,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => ensureSignedIn(
                  context,
                  reason: 'اعمل حسابك في ثانية عشان نحفظلك طلباتك وضماناتك.',
                ),
                style: FilledButton.styleFrom(minimumSize: const Size(220, 48)),
                child: const Text('اعمل حساب أو سجّل دخول'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
