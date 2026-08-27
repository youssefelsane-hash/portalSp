import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api_config.dart';
import '../../core/auth_repository.dart';
import '../../design/app_theme.dart';
import '../../design/empty_state.dart';
import '../../design/loading_list.dart';
import '../notifications/notifications_repository.dart';
import '../notifications/notifications_screen.dart';
import '../support/support_contact_repository.dart';
import '../support/support_contact_screen.dart';
import 'catalog_repository.dart';
import 'categories_screen.dart';
import 'category_tile.dart';
import 'featured_category_item.dart';
import 'home_hero.dart';
import 'home_header.dart';
import 'branding_repository.dart';
import 'homepage_content_repository.dart';
import 'models.dart';
import 'search_results_screen.dart';
import 'services_screen.dart';
import '../projects/create_project_screen.dart';

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
// اللوحة نفسها (الصورة + العنوان + شريط البحث + سطر الضمان) اتنقلت لـ`home_hero.dart` كودجت
// مستقلة `HomeHero` — الأرقام والتدرّجات بقت هناك. السبب مكتوب بالتفصيل في الملف ده: البَقّة
// اللي المالك شافها (شرايط صفرا جنب البحث) كانت في اللوحة، ودالة خاصة جوّه شاشة بتنادي الشبكة
// ما ينفعش تتقاس في اختبار.

// كانت _homeTips ثابتة في الكود (placeholder بصري بس) — بقت مُدارة من الأدمن (homepage.tips
// setting، بلاغ مالك صريح 2026-08-23: "مش لاقي له مكان أرفع منه الصور") عبر
// HomepageContentRepository تحت، نفس apps/customer-web بالحرف. لو الأدمن ما حطش imageUrl، بيرجع
// لنفس التدرّجات اللونية دي كـfallback (مُتسلسلة حسب index، نفس apps/customer-web's
// TIP_FALLBACK_BACKGROUNDS بالحرف).
const List<Color> _tipFallbackColors = [
  AppColors.primary,
  AppColors.success,
  AppColors.warning,
];

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
  // معلومات الضمان الحقيقية من السيرفر (docs/08 §75-ج) — `null` لحد ما توصل، والشريط
  // بيخفي بند الضمان بدل ما يعرض رقم مخترع.
  List<String> _heroImages = [];
  List<ImageProvider<Object>> _heroImageProviders = const [];
  HomepageSearchContent _searchContent = HomepageSearchContent.defaults;
  List<HomepageTip> _tips = [];
  SupportContact? _supportContact;
  BrandingLogo? _brandingLogo;
  BrandingLogo? _heroBackground;
  ImageProvider<Object>? _legacyHeroImageProvider;
  int _activeSlide = 0;
  Timer? _slideTimer;

  @override
  void initState() {
    super.initState();
    _load();
    // رسالة الثقة/الضمان ونصايح مفيدة وبيانات الدعم ولوجو البراندنج — تحميل مستقل عمدًا (فشل أي
    // واحد فيهم ميأثرش على باقي الشاشة، الأقسام المعتمدة عليهم بتختفي بهدوء).
    _homepageContentRepository
        .fetch()
        .then(_applyHomepageContent)
        .catchError((_) {});
    _supportContactRepository
        .fetch()
        .then((contact) {
          if (mounted) setState(() => _supportContact = contact);
        })
        .catchError((_) {});
    _brandingRepository
        .fetchPrimaryLogo()
        .then((logo) {
          if (mounted) setState(() => _brandingLogo = logo);
        })
        .catchError((_) {});
    // صورة splash القديمة تفضل fallback لو قائمة homepage.hero_images الجديدة فاضية.
    _brandingRepository
        .fetchHeroBackground()
        .then(_applyLegacyHeroBackground)
        .catchError((_) {});
    _slideTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted) return;
      final count = _heroImages.isNotEmpty
          ? _heroImages.length
          : (_heroBackground == null ? heroFallbackSlideCount : 1);
      if (count > 1) setState(() => _activeSlide = (_activeSlide + 1) % count);
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

  void _applyHomepageContent(HomepageContent content) {
    if (!mounted) return;
    final providers = content.heroImages
        .map(_resolveHeroImageUrl)
        .map<ImageProvider<Object>>(NetworkImage.new)
        .toList(growable: false);
    setState(() {
      _trustMessage = content.trustMessage;
      _heroImages = content.heroImages;
      _heroImageProviders = providers;
      _searchContent = content.search;
      _tips = content.tips;
      _activeSlide = 0;
    });
    for (final provider in providers) {
      unawaited(_precacheHeroImage(provider));
    }
  }

  void _applyLegacyHeroBackground(BrandingLogo? asset) {
    if (!mounted || asset == null || asset.isDefault) return;
    final provider = NetworkImage(asset.url);
    setState(() {
      _heroBackground = asset;
      _legacyHeroImageProvider = provider;
      _activeSlide = 0;
    });
    unawaited(_precacheHeroImage(provider));
  }

  Future<void> _precacheHeroImage(ImageProvider<Object> provider) async {
    if (!mounted) return;
    try {
      await precacheImage(provider, context);
    } catch (_) {
      // The visual fallback remains available when an admin URL is unreachable.
    }
  }

  void _openSearch([String value = '']) => Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => SearchResultsScreen(initialQuery: value)),
  );

  @override
  Widget build(BuildContext context) {
    final featured =
        _categories?.where((c) => c.isFeatured).toList() ??
        const <ServiceCategory>[];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          // docs/08 §75-ب — العنوان بقى هو عنوان الشاشة نفسه («فوق خالص يبقى العنوان إن
          // الـcustomer بينتمي لي»). طلباتي/حسابي اتنقلوا للشريط السفلي، فالرأس فضي من
          // الأربع أيقونات المزحومة وفضل فيه اللي بيتفتح عند حدث بس: الإشعارات والدعم.
          titleSpacing: 8,
          // شعار الأدمن المرفوع بيفضل ظاهر — بس صغير على الجنب، مش عنوان الشاشة. لو الأدمن
          // ما رفعش شعار (`isDefault`)، مفيش leading خالص والعنوان بياخد العرض كله: الشكل
          // المرجعي اللي المالك بعته مفيهوش شعار في الرأس أصلاً.
          leading: _brandingLogo != null && !_brandingLogo!.isDefault && _brandingLogo!.url.isNotEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  child: Image.network(
                    _resolveHeroImageUrl(_brandingLogo!.url),
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                )
              : null,
          title: HomeLocationHeader(onAddressChanged: (_) => _load()),
          actions: [
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
            IconButton(
              icon: const Icon(Icons.support_agent_outlined),
              tooltip: 'الدعم',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const SupportContactScreen()),
              ),
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              HomeHero(
                images: _heroImageProviders.isNotEmpty
                    ? _heroImageProviders
                    : (_legacyHeroImageProvider == null
                          ? const <ImageProvider<Object>>[]
                          : <ImageProvider<Object>>[_legacyHeroImageProvider!]),
                activeIndex: _activeSlide,
                content: _searchContent,
                trustMessage: _trustMessage,
                onSearch: _openSearch,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // **ترتيب الأقسام (docs/08 §76-د، طلب مالك صريح)**: صورة → الأكثر طلبًا →
                    // كارت المشروع → كل الفئات. الكارت اتنقل من تحت الشبكة لفوقها: «ارفعها
                    // فوق، خليها موجودة قبل كل الفئات». والمنطق سليم — الشبكة الكاملة (9+
                    // فئة) بتاخد شاشة كاملة، فأي حاجة تحتها فعليًا مش موجودة لأغلب العملاء.
                    if (featured.isNotEmpty) ...[
                      Text(
                        'الأكثر طلبًا',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        // 84 → ~72: الصف بقى أصغر بطلب المالك، والرقم محسوب من الأيقونة +
                        // المسافة + سطر الاسم بمقياس خط المستخدم — مش تقدير ثابت.
                        height: featuredRowHeight(context),
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: featured.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 14),
                          itemBuilder: (context, index) =>
                              FeaturedCategoryItem(
                                category: featured[index],
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => ServicesScreen(
                                      category: featured[index],
                                    ),
                                  ),
                                ),
                              ),
                        ),
                      ),
                      // كانت 24 — بلاغ مالك: «فيه مسافة كبيرة بين آخر كلمة موجودة وكل الفئات».
                      const SizedBox(height: 16),
                    ],
                    _ProjectCta(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => CreateProjectScreen(
                            auth: context.read<AuthRepository>(),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'كل الفئات',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        TextButton(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => const CategoriesScreen(),
                            ),
                          ),
                          child: const Text('عرض الكل'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        child: Center(child: Text(_error!)),
                      )
                    else if (_categories == null)
                      const LoadingList()
                    else if (_categories!.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: EmptyState(
                            icon: Icons.category_outlined,
                            title: 'مفيش فئات خدمات متاحة دلوقتي',
                          ),
                        ),
                      )
                    else
                      // docs/08 §75-ب — تلات أعمدة بخانات مدمجة بدل عمودين بكروت كاملة.
                      // عمودين معناه كارت عرضه نص الشاشة لفئة واحدة: تسع فئات = ثلاث شاشات
                      // scroll، والعميل مش شايف اللي متاح. تلاتة بتخلّي تسع فئات في شاشة
                      // واحدة تقريبًا — وده الفرق الحقيقي بين "قائمة" و"واجهة اختيار".
                      // `childAspectRatio` محسوب: صورة 1:1 + 8 مسافة + سطرين اسم ≈ العرض + 44.
                      LayoutBuilder(
                        builder: (context, constraints) {
                          const columns = 3;
                          const spacing = 12.0;
                          final tileWidth =
                              (constraints.maxWidth - spacing * (columns - 1)) / columns;
                          // الارتفاع المحجوز للاسم بيتحسب من مقياس خط المستخدم الفعلي —
                          // رقم ثابت هنا كان بيعمل overflow مع تكبير الخط (اتلقط بالاختبار).
                          final labelHeight = categoryTileLabelHeight(context);
                          return GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            gridDelegate:
                                SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: columns,
                              mainAxisSpacing: 16,
                              crossAxisSpacing: spacing,
                              childAspectRatio: tileWidth / (tileWidth + labelHeight),
                            ),
                            itemCount: _categories!.length,
                            itemBuilder: (context, index) {
                              final category = _categories![index];
                              return CategoryTile(
                                category: category,
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ServicesScreen(category: category),
                                  ),
                                ),
                              );
                            },
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

  /// hero دوّار (طلب مالك صريح 2026-08-22/23، تصميم مرجعي: Angi.com).
  ///
  /// docs/08 §64.د — طلب المالك: «كبرلي مساحة الصورة اللي بتتغير… وتصغرلي محرك البحث…
  /// محتاج يبقى مدور شوية… professional وأصغر من كده بكتير».
  ///
  /// اللي اتغيّر عن النسخة القديمة:
  ///  1. **ارتفاع صريح للصورة** (`_heroHeight`) بدل ما الارتفاع يطلع من حجم النص + padding —
  ///     ده كان بيخلّي الصورة شريط رفيع كل ما النص يقصر.
  ///  2. **اتشال الصندوق الغامق** اللي كان لافّ النص والبحث — كان بيغطّي نص مساحة الصورة.
  ///     البديل: تدرّج أسود خفيف من تحت + ظل على النص، فالصورة بانت والنص فضل مقروء.
  ///  3. **الصورة بتتبدّل بـcross-fade حقيقي** (طبقات صور محمّلة مسبقًا) بدل
  ///     `DecorationImage` جوّه `AnimatedContainer` — الأخيرة مبتعملش fade بين صورتين أصلاً،
  ///     فالتبديل كان بيحصل قطع مفاجئ.
  ///  4. شريط البحث بقى **حبّة (pill)** أقصر بكتير — `_HeroSearchField` تحت.
  String _resolveHeroImageUrl(String value) {
    if (value.startsWith('http')) return value;
    final origin = apiBaseUrl.replaceFirst(RegExp(r'/api/v1/?$'), '');
    return '$origin$value';
  }

  // عنوان الـAppBar — لوجو البراندنج الحقيقي (لو الأدمن رفع واحد، isDefault=false دايمًا صورة
  // raster حقيقية) بدل النص الثابت "صُنّاع" (بلاغ مالك صريح 2026-08-23: "الصور مش بتظهر على
  // الأبليكيشن" — التطبيق أصلاً مكانش بيستهلك /branding خالص). errorBuilder يرجع للنص لو تحميل
  // الصورة فشل لأي سبب (شبكة، رابط اترفض)، مش بيوقف التطبيق أبدًا.

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
          Text(
            'حاجات كويس تعرفها قبل ما تحجز أي شغلانة',
            style: Theme.of(context).textTheme.bodySmall,
          ),
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
                            errorBuilder: (_, _, _) => Container(
                              height: 80,
                              color:
                                  _tipFallbackColors[index %
                                      _tipFallbackColors.length],
                            ),
                          )
                        else
                          Container(
                            height: 80,
                            color:
                                _tipFallbackColors[index %
                                    _tipFallbackColors.length],
                          ),
                        // Expanded + Flexible مش تزيين: الكارت جوّه `SizedBox(height: 190)` ثابت،
                        // والصورة بتاخد 80 منهم. من غيرهم أي نصيحة عنوانها بيلف سطرين ونصّها 3
                        // سطور كانت بتطلع أطول من الفاضل وترمي `RenderFlex overflowed by N pixels
                        // on the bottom` كل frame (اتلقطت في كونسول المالك، docs/08 §59). كده
                        // النص بياخد الفاضل بالظبط ويتقص بأدب مهما كان مقياس الخط عند المستخدم.
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  tip.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                                const SizedBox(height: 4),
                                Flexible(
                                  child: Text(
                                    tip.body,
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.bodySmall,
                                  ),
                                ),
                              ],
                            ),
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
    if (contact == null ||
        !contact.enabled ||
        (contact.phoneNumber == null && contact.whatsappUrl == null)) {
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
          Text(
            'محتاج مساعدة؟ إحنا هنا',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              if (contact.phoneNumber != null)
                OutlinedButton.icon(
                  onPressed: () =>
                      launchUrl(Uri(scheme: 'tel', path: contact.phoneNumber!)),
                  icon: const Icon(Icons.call_outlined),
                  label: Text(
                    contact.phoneNumber!,
                    textDirection: TextDirection.ltr,
                  ),
                ),
              if (contact.whatsappUrl != null)
                OutlinedButton.icon(
                  onPressed: () => launchUrl(
                    Uri.parse(contact.whatsappUrl!),
                    mode: LaunchMode.externalApplication,
                  ),
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

/// كارت «بتجهز أو بتشطب بيتك؟» — بعد الخدمات مباشرة (docs/08 §75-ج).
///
/// النص حرفيًا زي ما المالك كتبه. والمكان مقصود: العميل اللي عدّى على كل الفئات وما لقاش
/// اللي بيدور عليه هو بالظبط اللي محتاج يعرف إن فيه مسار مشروع كامل — عرضه فوق قبل الخدمات
/// كان بيزاحم أول حاجة العميل جاي عشانها.
class _ProjectCta extends StatelessWidget {
  const _ProjectCta({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.primaryContainer,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'بتجهز أو بتشطب بيتك؟ 🏠',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'من المعاينة لحد التسليم، خلّي مشروعك كله في مكان واحد.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'ابدأ مشروع',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    Icons.arrow_back_rounded,
                    size: 18,
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
