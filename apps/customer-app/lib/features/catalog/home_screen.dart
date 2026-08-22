import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/auth_repository.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../account/account_screen.dart';
import '../notifications/notifications_repository.dart';
import '../notifications/notifications_screen.dart';
import '../orders/orders_screen.dart';
import '../support/support_contact_screen.dart';
import 'catalog_repository.dart';
import 'categories_screen.dart';
import 'category_card.dart';
import 'models.dart';
import 'search_results_screen.dart';
import 'services_screen.dart';

// Script 3 §2/§3/§5/§32 — أول شاشة بعد تسجيل الدخول، محل BookingModeScreen القديمة اللي كانت
// بتسأل "فرد ولا فريق؟" فورًا (anti-pattern صريح — العميل ما بيشوفش وصف مشكلته أصلاً قبل سؤال
// تشغيلي داخلي). دلوقتي أول حاجة العميل بيشوفها: "قول لينا محتاج مساعدة في إيه؟" — بحث/تصفح
// فئات، بدون أي سؤال عن وضع الحجز. وضع الحجز (فرد/اعتماد/طوارئ) بقى بيتقرر بعد اختيار الخدمة
// (catalog_navigation.dart)، وبس لو الخدمة فعلاً بتدعم أكتر من وضع.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _repository = CatalogRepository();
  List<ServiceCategory>? _categories;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final categories = await _repository.fetchCategories();
      if (mounted) setState(() => _categories = categories);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذّر تحميل الفئات — اسحب لتحديث');
    }
  }

  @override
  Widget build(BuildContext context) {
    final featured = _categories?.where((c) => c.isFeatured).toList() ?? const <ServiceCategory>[];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('صُنّاع'),
          actions: [
            IconButton(
              icon: const Icon(Icons.receipt_long),
              tooltip: 'طلباتي',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OrdersScreen())),
            ),
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
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen())),
                  );
                },
              ),
            ),
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'الدعم',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SupportContactScreen())),
            ),
            IconButton(
              icon: const Icon(Icons.person_outline),
              tooltip: 'حسابي',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AccountScreen())),
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('محتاج مساعدة في إيه؟', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
              const SizedBox(height: 4),
              Text(
                'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
                style: Theme.of(context).textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              // Script 3 §5/§6 — الحقل الأساسي في الشاشة: مدخل وصف المشكلة، مش زرار "فرد/فريق".
              _SearchEntryField(
                onSubmitted: (value) => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => SearchResultsScreen(initialQuery: value)),
                ),
              ),
              if (featured.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('الأكثر طلبًا', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                SizedBox(
                  height: 44,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: featured.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (context, index) {
                      final category = featured[index];
                      return ActionChip(
                        label: Text(category.nameAr),
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => ServicesScreen(category: category)),
                        ),
                      );
                    },
                  ),
                ),
              ],
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('كل الفئات', style: Theme.of(context).textTheme.titleMedium),
                  TextButton(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CategoriesScreen())),
                    child: const Text('عرض الكل'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_error != null)
                Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Center(child: Text(_error!)))
              else if (_categories == null)
                const LoadingList()
              else if (_categories!.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: EmptyState(icon: Icons.category_outlined, title: 'مفيش فئات خدمات متاحة دلوقتي')),
                )
              else
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 0.95,
                  ),
                  itemCount: _categories!.length,
                  itemBuilder: (context, index) {
                    final category = _categories![index];
                    return CategoryCard(
                      category: category,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => ServicesScreen(category: category)),
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchEntryField extends StatelessWidget {
  final ValueChanged<String> onSubmitted;

  const _SearchEntryField({required this.onSubmitted});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => onSubmitted(''),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: Row(
          children: [
            Icon(Icons.search, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
