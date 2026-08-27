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
import 'home_header.dart';
import 'trust_strip.dart';
import 'branding_repository.dart';
import 'homepage_content_repository.dart';
import 'hero_image_crossfade.dart';
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
// ارتفاع الـhero (docs/08 §64.د) — ثابت صريح عشان مساحة الصورة ما تعتمدش على طول النص. القيمة
// دي بتدي الصورة مساحة حقيقية (كانت بتطلع شريط رفيع لما النص يقصر) وفي نفس الوقت بتسيب الفئات
// المميّزة ظاهرة تحتها من غير scroll على شاشات الموبايل العادية.
// docs/08 §75-ب (بلاغ مالك 2026-08-27: «نسيب الصورة الموجودة ولكن نصغرها شوية، بس برضه الـsearch
// يبقى واضح»). 300 كانت بتاكل الشاشة كلها فوق الطية — الفئات مكانتش بتبان غير بعد scroll، وده
// اللي بيخلي الشاشة تحس إنها "صفحة إعلان" مش أداة. 200 بتسيب البحث + أول صف فئات ظاهرين مع
// بعض على شاشة موبايل عادية، والصورة لسه ليها حضور حقيقي.
const double _heroHeight = 200;

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
  TrustInfo? _trustInfo;
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
          : (_heroBackground == null ? _heroGradients.length : 1);
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
    // معلومات الثقة مستقلة عن الفئات: فشلها ما يمنعش عرض الكتالوج، ونجاحها ما يستناش الفئات.
    final trust = await fetchTrustInfo();
    if (mounted && trust != null) setState(() => _trustInfo = trust);
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
              _buildHero(context),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (featured.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        'الأكثر طلبًا',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 84,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: featured.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 16),
                          itemBuilder: (context, index) =>
                              _FeaturedCategoryItem(
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
                      const SizedBox(height: 24),
                    ] else
                      const SizedBox(height: 8),
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
                    // ترتيب المالك الصريح: «كارت التشطيب يفضل موجود، لكن **بعد الخدمات
                    // مباشرة**». منطقيًا برضه — العميل اللي دوّر في الفئات وما لقاش اللي
                    // بيدور عليه، ده بالظبط اللي محتاج يعرف إن فيه مسار مشروع كامل.
                    const SizedBox(height: 24),
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
                    TrustStrip(warranty: _trustInfo),
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
  Widget _buildHero(BuildContext context) {
    final effectiveImages = _heroImageProviders.isNotEmpty
        ? _heroImageProviders
        : (_legacyHeroImageProvider == null
              ? const <ImageProvider<Object>>[]
              : <ImageProvider<Object>>[_legacyHeroImageProvider!]);
    final gradientIndex = _activeSlide % _heroGradients.length;
    return SizedBox(
      height: _heroHeight,
      child: Stack(
        fit: StackFit.expand,
        children: [
          HeroImageCrossfade(
            images: effectiveImages,
            activeIndex: _activeSlide,
            fallback: AnimatedContainer(
              // التدرّج بيتحرّك بس لما هو نفسه الخلفية المعروضة. لما فيه صور، هو مجرد شبكة أمان
              // تحتها فمفيش داعي يستهلك فريمات في أنيميشن محدش شايفه.
              duration: Duration(
                milliseconds: effectiveImages.isEmpty ? 1000 : 0,
              ),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: _heroGradients[gradientIndex],
                ),
              ),
            ),
          ),
          // تدرّج قراءة: غامق تحت وشفاف فوق — أخف من الصندوق القديم بكتير، فالصورة بانت.
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.72),
                  Colors.black.withValues(alpha: 0.25),
                  Colors.transparent,
                ],
                stops: const [0, 0.55, 1],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 1),
              duration: const Duration(milliseconds: 700),
              curve: Curves.easeOutCubic,
              builder: (context, value, child) => Opacity(
                opacity: value,
                child: Transform.translate(
                  offset: Offset(0, 16 * (1 - value)),
                  child: child,
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _searchContent.eyebrow,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.8),
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      shadows: const [
                        Shadow(color: Colors.black54, blurRadius: 6),
                      ],
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _searchContent.title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 8)],
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _searchContent.description,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontSize: 12.5,
                      shadows: const [
                        Shadow(color: Colors.black54, blurRadius: 6),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  _HeroSearchField(
                    content: _searchContent,
                    onSearch: _openSearch,
                  ),
                  if (_trustMessage.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.verified_outlined,
                          color: Colors.white,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            _trustMessage,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                              fontSize: 13,
                              shadows: [
                                Shadow(color: Colors.black45, blurRadius: 4),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (effectiveImages.length > 1) ...[
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(
                        effectiveImages.length,
                        (index) => AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          width: index == _activeSlide ? 22 : 7,
                          height: 7,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            color: index == _activeSlide
                                ? Colors.white
                                : Colors.white54,
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

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

// حقل البحث جوّه لوحة الـhero: مضغوط وهو خامل عشان الصورة تفضل ظاهرة، ويتمدد عند التركيز ويقبل
// الكتابة مباشرة قبل فتح شاشة النتائج. النص كله جاي من إعداد homepage.search_content.
class _HeroSearchField extends StatefulWidget {
  final HomepageSearchContent content;
  final ValueChanged<String> onSearch;

  const _HeroSearchField({required this.content, required this.onSearch});

  @override
  State<_HeroSearchField> createState() => _HeroSearchFieldState();
}

class _HeroSearchFieldState extends State<_HeroSearchField> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onFocusChanged() => setState(() {});

  void _submit() {
    _focusNode.unfocus();
    widget.onSearch(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final expanded = _focusNode.hasFocus || _controller.text.isNotEmpty;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.86, end: expanded ? 0.98 : 0.86),
      duration: const Duration(milliseconds: 240),
      curve: Curves.easeOutCubic,
      // الحد الأقصى مقصود (docs/08 §65.3): `widthFactor` لوحده معناه إن الشريط بيتمدد بعرض
      // الشاشة كلها — على موبايل ده مظبوط، بس على تابلت/ديسكتوب بيبقى شريط بعرض 1100px وشكله
      // بعيد تمامًا عن «professional وأصغر» اللي المالك طلبه. 460 بيسيبه بعرضه الطبيعي على
      // الموبايل ويلجمه على الشاشات الكبيرة.
      builder: (context, widthFactor, child) => FractionallySizedBox(
        widthFactor: widthFactor,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: child,
          ),
        ),
      ),
      child: AnimatedContainer(
        height: expanded ? 58 : 52,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: expanded ? 1 : 0.96),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: expanded
                ? AppColors.primary.withValues(alpha: 0.7)
                : Colors.white.withValues(alpha: 0.72),
            width: expanded ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: expanded ? 0.2 : 0.14),
              blurRadius: expanded ? 22 : 14,
              offset: const Offset(0, 7),
            ),
            if (expanded)
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.14),
                blurRadius: 0,
                spreadRadius: 4,
              ),
          ],
        ),
        child: TextField(
          key: const ValueKey('homepage-hero-search'),
          controller: _controller,
          focusNode: _focusNode,
          cursorColor: AppColors.primary,
          style: const TextStyle(
            color: Color(0xFF172033),
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _submit(),
          onChanged: (_) => setState(() {}),
          onTapOutside: (_) => _focusNode.unfocus(),
          decoration: InputDecoration(
            hintText: widget.content.placeholder,
            hintStyle: TextStyle(
              color: Colors.blueGrey.shade500,
              fontSize: 13,
              fontWeight: FontWeight.w400,
            ),
            prefixIcon: Padding(
              padding: const EdgeInsets.all(7),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.search_rounded,
                  color: AppColors.primary,
                  size: 21,
                ),
              ),
            ),
            suffixIcon: expanded
                ? Padding(
                    padding: const EdgeInsets.all(7),
                    child: IconButton.filled(
                      style: IconButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                      ),
                      icon: const Icon(Icons.arrow_back_rounded, size: 20),
                      tooltip: 'بحث',
                      onPressed: _submit,
                    ),
                  )
                : null,
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: const EdgeInsets.symmetric(horizontal: 10),
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
                          style: TextStyle(
                            color: scheme.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    )
                  : Text(
                      category.nameAr.characters.first,
                      style: TextStyle(
                        color: scheme.primary,
                        fontWeight: FontWeight.bold,
                      ),
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
