import 'dart:async';

import 'package:characters/characters.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/auth_repository.dart';
import '../../design/app_theme.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../account/account_screen.dart';
import '../notifications/notifications_repository.dart';
import '../notifications/notifications_screen.dart';
import '../orders/orders_screen.dart';
import '../support/support_contact_repository.dart';
import '../support/support_contact_screen.dart';
import 'catalog_repository.dart';
import 'categories_screen.dart';
import 'category_card.dart';
import 'branding_repository.dart';
import 'homepage_content_repository.dart';
import 'models.dart';
import 'search_results_screen.dart';
import 'services_screen.dart';

// Script 3 §2/§3/§5/§32 — أول شاشة بعد تسجيل الدخول، محل BookingModeScreen القديمة اللي كانت
// بتسأل "فرد ولا فريق؟" فورًا (anti-pattern صريح — العميل ما بيشوفش وصف مشكلته أصلاً قبل سؤال
// تشغيلي داخلي). دلوقتي أول حاجة العميل بيشوفها: "قول لينا محتاج مساعدة في إيه؟" — بحث/تصفح
// فئات، بدون أي سؤال عن وضع الحجز. وضع الحجز (فرد/اعتماد/طوارئ) بقى بيتقرر بعد اختيار الخدمة
// (catalog_navigation.dart)، وبس لو الخدمة فعلاً بتدعم أكتر من وضع.

// hero دوّار + رسالة ثقة/ضمان + قسم نصايح + قسم دعم (طلب مالك صريح 2026-08-22/23 — "نفس الشكل
// في كل حتة"، نفس تصميم apps/customer-web's homepage بالحرف، مبني على تصميم مرجعي Angi.com).
// **HERO_GRADIENTS مؤقتة عمدًا** — تدرّجات بهوية العلامة (AppColors) بدل صور فوتوغرافية حقيقية،
// نفس السبب ونفس القيم المستخدمة في apps/customer-web/src/app/page.tsx (مفيش أصل صورة حقيقي
// متاح في المشروع لسه). استبدال المصفوفة دي بصور حقيقية كل اللي محتاجه لاحقًا.
// بَقّة حقيقية (2026-08-23، ملاحظة مالك: "الخلفية دايمًا زرقة ما بتتغيرش") — التلات تدرّجات
// كانوا فعليًا شغالين (rotation نفسه اتأكد حي بـتصوير t=0/t=7s قبل كده)، بس slide 1 وslide 3
// كانوا شبه متطابقين بصريًا (نفس عائلة الأزرق النافي بنفس درجة الإضاءة تقريبًا) — نظرة سريعة
// من المستخدم بتوقع تلاقيه على واحد من الاتنين مرتين ورا بعض فتحس إن "مفيش تغيير خالص". الحل:
// سلّم إضاءة واضح (غامق/متوسط/فاتح) بدل تنويع هوية اللون — يفضل داخل عائلة الأزرق نفسها (نفس
// المبدأ الحاكم في CLAUDE.md، "نفس الشكل في كل حتة")، مطابق تمامًا لـapps/customer-web's HERO_SLIDES.
const List<List<Color>> _heroGradients = [
  [Color(0xFF1C3A6E), Color(0xFF2F5AA6), Color(0xFF4D78C4)],
  [Color(0xFF0F1115), Color(0xFF22314F), Color(0xFF2F5AA6)],
  [Color(0xFF2F5AA6), Color(0xFF4D78C4), Color(0xFF7FA6E0)],
];

// كانت _homeTips ثابتة في الكود (placeholder بصري بس) — بقت مُدارة من الأدمن (homepage.tips
// setting، بلاغ مالك صريح 2026-08-23: "مش لاقي له مكان أرفع منه الصور") عبر
// HomepageContentRepository تحت، نفس apps/customer-web بالحرف. لو الأدمن ما حطش imageUrl، بيرجع
// لنفس التدرّجات اللونية دي كـfallback (مُتسلسلة حسب index، نفس apps/customer-web's
// TIP_FALLBACK_BACKGROUNDS بالحرف).
const List<Color> _tipFallbackColors = [AppColors.primary, AppColors.success, AppColors.warning];

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _repository = CatalogRepository();
  final _homepageContentRepository = HomepageContentRepository();
  final _supportContactRepository = SupportContactRepository();
  final _brandingRepository = BrandingRepository();
  List<ServiceCategory>? _categories;
  String? _error;
  String _trustMessage = '';
  List<HomepageTip> _tips = [];
  SupportContact? _supportContact;
  BrandingLogo? _brandingLogo;
  int _activeSlide = 0;
  Timer? _slideTimer;

  @override
  void initState() {
    super.initState();
    _load();
    // رسالة الثقة/الضمان ونصايح مفيدة وبيانات الدعم ولوجو البراندنج — تحميل مستقل عمدًا (فشل أي
    // واحد فيهم ميأثرش على باقي الشاشة، الأقسام المعتمدة عليهم بتختفي بهدوء).
    _homepageContentRepository.fetch().then((content) {
      if (mounted) setState(() {
        _trustMessage = content.trustMessage;
        _tips = content.tips;
      });
    }).catchError((_) {});
    _supportContactRepository.fetch().then((contact) {
      if (mounted) setState(() => _supportContact = contact);
    }).catchError((_) {});
    _brandingRepository.fetchPrimaryLogo().then((logo) {
      if (mounted) setState(() => _brandingLogo = logo);
    }).catchError((_) {});
    _slideTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (mounted) setState(() => _activeSlide = (_activeSlide + 1) % _heroGradients.length);
    });
  }

  @override
  void dispose() {
    _slideTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final categories = await _repository.fetchCategories();
      if (mounted) setState(() => _categories = categories);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذّر تحميل الفئات — اسحب لتحديث');
    }
  }

  void _openSearch([String value = '']) => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => SearchResultsScreen(initialQuery: value)),
      );

  @override
  Widget build(BuildContext context) {
    final featured = _categories?.where((c) => c.isFeatured).toList() ?? const <ServiceCategory>[];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: _buildAppBarTitle(),
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
            padding: EdgeInsets.zero,
            children: [
              _buildHero(context),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (featured.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text('الأكثر طلبًا', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 84,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: featured.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 16),
                          itemBuilder: (context, index) => _FeaturedCategoryItem(
                            category: featured[index],
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => ServicesScreen(category: featured[index])),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                    ] else
                      const SizedBox(height: 8),
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
                    _buildTipsSection(context),
                    _buildSupportSection(context),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // hero دوّار (طلب مالك صريح 2026-08-22/23، تصميم مرجعي: Angi.com) — لوحة شفافة غامقة فوق خلفية
  // متدرّجة دوّارة فيها التاجلاين + البحث، ورسالة الثقة/الضمان تحتها مباشرة فوق الصورة نفسها
  // (بلا صندوق عمدًا) — مطابق تمامًا لهيكل apps/customer-web's hero.
  Widget _buildHero(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 900),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _heroGradients[_activeSlide],
        ),
      ),
      child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Colors.black.withValues(alpha: 0.55), Colors.transparent],
                ),
              ),
              padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      children: [
                        Text('أساعدك إزاي؟', style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 13, fontWeight: FontWeight.w500)),
                        const SizedBox(height: 4),
                        const Text(
                          'محتاج مساعدة في إيه؟',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 13),
                        ),
                        const SizedBox(height: 16),
                        _HeroSearchField(onTap: _openSearch),
                      ],
                    ),
                  ),
                  if (_trustMessage.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.verified_outlined, color: Colors.white, size: 18),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            _trustMessage,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 13, shadows: [
                              Shadow(color: Colors.black45, blurRadius: 4),
                            ]),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  // عنوان الـAppBar — لوجو البراندنج الحقيقي (لو الأدمن رفع واحد، isDefault=false دايمًا صورة
  // raster حقيقية) بدل النص الثابت "صُنّاع" (بلاغ مالك صريح 2026-08-23: "الصور مش بتظهر على
  // الأبليكيشن" — التطبيق أصلاً مكانش بيستهلك /branding خالص). errorBuilder يرجع للنص لو تحميل
  // الصورة فشل لأي سبب (شبكة، رابط اترفض)، مش بيوقف التطبيق أبدًا.
  Widget _buildAppBarTitle() {
    final logo = _brandingLogo;
    if (logo == null || logo.isDefault || logo.url.isEmpty) {
      return const Text('صُنّاع');
    }
    return Image.network(
      logo.url,
      height: 32,
      fit: BoxFit.contain,
      errorBuilder: (_, _, _) => const Text('صُنّاع'),
    );
  }

  // "نصايح مفيدة" — مُدارة من الأدمن دلوقتي (تفاصيل في تعليق _tipFallbackColors فوق). مبتظهرش
  // خالص لو الأدمن مسحها كلها (نفس فلسفة رسالة الثقة/بيانات الدعم — بيختفي بهدوء بدل قسم فاضي).
  Widget _buildTipsSection(BuildContext context) {
    if (_tips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('نصايح مفيدة', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 2),
          Text('حاجات كويس تعرفها قبل ما تحجز أي شغلانة', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          SizedBox(
            height: 190,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _tips.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, index) {
                final tip = _tips[index];
                final imageUrl = tip.imageUrl;
                return SizedBox(
                  width: 220,
                  child: Card(
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (imageUrl != null && imageUrl.isNotEmpty)
                          Image.network(
                            imageUrl,
                            height: 80,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                Container(height: 80, color: _tipFallbackColors[index % _tipFallbackColors.length]),
                          )
                        else
                          Container(height: 80, color: _tipFallbackColors[index % _tipFallbackColors.length]),
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(tip.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleSmall),
                              const SizedBox(height: 4),
                              Text(
                                tip.body,
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // قسم "الدعم" آخر الشاشة (طلب مالك صريح 2026-08-23) — نفس بيانات SupportContactScreen
  // الموجودة بالفعل (زرار مستقل في الـAppBar فوق)، عرض مختصر هنا بس لنفس التناسق مع
  // apps/customer-web's homepage. مبيظهرش خالص لو enabled=false أو مفيش رقم حقيقي.
  Widget _buildSupportSection(BuildContext context) {
    final contact = _supportContact;
    if (contact == null || !contact.enabled || (contact.phoneNumber == null && contact.whatsappUrl == null)) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(top: 28, bottom: 8),
      child: Column(
        children: [
          const Divider(),
          const SizedBox(height: 16),
          Text('الدعم', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('محتاج مساعدة؟ إحنا هنا', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              if (contact.phoneNumber != null)
                OutlinedButton.icon(
                  onPressed: () => launchUrl(Uri(scheme: 'tel', path: contact.phoneNumber!)),
                  icon: const Icon(Icons.call_outlined),
                  label: Text(contact.phoneNumber!, textDirection: TextDirection.ltr),
                ),
              if (contact.whatsappUrl != null)
                OutlinedButton.icon(
                  onPressed: () => launchUrl(Uri.parse(contact.whatsappUrl!), mode: LaunchMode.externalApplication),
                  icon: const Icon(Icons.chat_outlined),
                  label: const Text('واتساب'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// حقل البحث جوّه لوحة الـhero — نفس تفاعل _SearchEntryField القديمة بالضبط (تاب بيفتح شاشة
// البحث، مفيش كتابة هنا)، بس بخلفية بيضاء صريحة (مش لون الـTheme المتغيّر) عشان يفضل واضح فوق
// أي لون من ألوان الـhero الدوّارة، مطابق لـapps/customer-web's `bg-surface` داخل اللوحة الغامقة.
class _HeroSearchField extends StatelessWidget {
  final ValueChanged<String> onTap;

  const _HeroSearchField({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onTap(''),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              const Icon(Icons.search, color: Colors.black54),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
                  style: TextStyle(color: Colors.black54),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// "الأكثر طلبًا" — أيقونة فوق + اسم تحت، بلا صندوق/حدود (طلب مالك صريح 2026-08-22، نفس هيكل
// apps/customer-web's الفئات المميّزة). icon_url لو موجود، وإلا حرف أول اسم الفئة كـfallback.
class _FeaturedCategoryItem extends StatelessWidget {
  final ServiceCategory category;
  final VoidCallback onTap;

  const _FeaturedCategoryItem({required this.category, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 76,
        child: Column(
          children: [
            CircleAvatar(
              radius: 28,
              backgroundColor: scheme.surfaceContainerHighest,
              child: category.iconUrl != null
                  ? ClipOval(
                      child: Image.network(
                        category.iconUrl!,
                        width: 32,
                        height: 32,
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) => Text(
                          category.nameAr.characters.first,
                          style: TextStyle(color: scheme.primary, fontWeight: FontWeight.bold),
                        ),
                      ),
                    )
                  : Text(
                      category.nameAr.characters.first,
                      style: TextStyle(color: scheme.primary, fontWeight: FontWeight.bold),
                    ),
            ),
            const SizedBox(height: 6),
            Text(
              category.nameAr,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
