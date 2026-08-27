import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/catalog/category_tile.dart';
import 'package:customer_app/features/catalog/featured_category_item.dart';
import 'package:customer_app/features/catalog/home_hero.dart';
import 'package:customer_app/features/catalog/homepage_content_repository.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/shell/customer_shell.dart';

// docs/08 §75/§76 — إعادة تصميم واجهة العميل. الاختبارات دي بتقيس **البنية الفعلية بعد الرندر**
// (مواضع وأحجام حقيقية)، مش وجود ودجت بالاسم — الدرس من §72: `flutter analyze` بيمسك الأنواع،
// مش الـlayout، وكارت 568px لمحتوى 350px عدّى منه.
ServiceCategory _category(String name, {String? image}) => ServiceCategory.fromJson({
      'id': 'cat-$name',
      'name_ar': name,
      'name_en': name,
      'slug': 'slug-$name',
      'icon_url': image,
      'cover_image_url': image,
      'is_featured': false,
      'display_order': 0,
    });

void main() {
  Widget wrap(Widget child, {double width = 390}) => MaterialApp(
        theme: AppTheme.light(),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: Center(
              child: SizedBox(width: width, child: child),
            ),
          ),
        ),
      );

  group('CategoryTile — خانة الفئة المدمجة', () {
    testWidgets('الاسم تحت الصورة مش جوّاها — ده جوهر الشكل الجديد', (tester) async {
      await tester.pumpWidget(wrap(
        SizedBox(width: 116, child: CategoryTile(category: _category('سباكة'), onTap: () {})),
        width: 116,
      ));

      final imageBottom = tester.getBottomRight(find.byType(AspectRatio)).dy;
      final labelTop = tester.getTopRight(find.text('سباكة')).dy;
      expect(labelTop, greaterThanOrEqualTo(imageBottom));
    });

    testWidgets('الصورة مربّعة — نسبة 1:1 زي المرجع', (tester) async {
      await tester.pumpWidget(wrap(
        SizedBox(width: 116, child: CategoryTile(category: _category('كهرباء'), onTap: () {})),
        width: 116,
      ));
      final size = tester.getSize(find.byType(AspectRatio));
      expect(size.height, closeTo(size.width, 1));
    });

    testWidgets('اسم طويل بياخد سطرين بدل ما يتقص من الأول', (tester) async {
      const longName = 'تأسيس كهرباء كامل لشقة';
      await tester.pumpWidget(wrap(
        SizedBox(width: 116, child: CategoryTile(category: _category(longName), onTap: () {})),
        width: 116,
      ));
      final textWidget = tester.widget<Text>(find.text(longName));
      expect(textWidget.maxLines, 2);
    });

    // الشبكة بتستخدم `childAspectRatio` ثابت، يعني ارتفاع الخانة محجوز مقدمًا. اسم بسطرين
    // مع تكبير خط النظام هو بالظبط السيناريو اللي بيعمل RenderFlex overflow — وده باين
    // للمستخدم كشريط أصفر/أسود. الاختبار ده بيمسكه قبل ما يوصله.
    testWidgets('اسم طويل + تكبير خط النظام: مفيش overflow', (tester) async {
      const longName = 'تأسيس كهرباء كامل لشقة';
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light(),
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              body: Center(
                child: Builder(
                  builder: (context) => SizedBox(
                    width: 116,
                    // نفس الحساب اللي الشبكة بتستخدمه بالظبط — لو اتفرقوا، الاختبار ده
                    // ما يبقاش بيختبر الحقيقة.
                    height: 116 + categoryTileLabelHeight(context),
                    child: CategoryTile(category: _category(longName), onTap: () {}),
                  ),
                ),
              ),
            ),
          ),
        ),
      ));
      expect(tester.takeException(), isNull);
    });

    testWidgets('الضغط بيفتح الفئة', (tester) async {
      var tapped = false;
      await tester.pumpWidget(wrap(
        SizedBox(width: 116, child: CategoryTile(category: _category('نجارة'), onTap: () => tapped = true)),
        width: 116,
      ));
      await tester.tap(find.byType(CategoryTile));
      expect(tapped, isTrue);
    });
  });

  // docs/08 §76-ب — **بَقّة حقيقية بلّغ عنها المالك بلقطة من الجهاز**:
  // `BOTTOM OVERFLOWED BY 43 PIXELS` جنب شريط البحث. السبب: ارتفاع الـhero كان مقفول
  // (`SizedBox(height: 200)`) ومحتواه محتاج ~242. المجموعة دي بترسم اللوحة بمحتوى حقيقي في
  // ظروف قاسية عمدًا وتتأكد إن مفيش استثناء رندر.
  //
  // **`pumpAndSettle` مش رفاهية هنا — من غيرها الاختبار بيعدّي على النسخة المكسورة**: اللوحة
  // بتدخل بأنيميشن `Opacity` من 0، و`RenderOpacity` بتتخطى رسم أولادها بالكامل لما الشفافية
  // صفر. وخطأ الـoverflow بيتبلّغ **وقت الرسم**. يعني فريم واحد بعد `pumpWidget` = صفر رسم =
  // صفر خطأ، حتى والارتفاع مقفول والمحتوى فايض فعلاً (اتجرّب: الاختبار عدّى أخضر على النسخة
  // المكسورة قبل ما نضيف السطر ده).
  group('HomeHero — مفيش overflow مهما كان المحتوى', () {
    /// بترسم اللوحة وتستنى أنيميشن الدخول يخلص، وترجّع أي استثناء رندر حصل.
    Future<Object?> renderAndCatch(WidgetTester tester, Widget app) async {
      await tester.pumpWidget(app);
      await tester.pumpAndSettle();
      return tester.takeException();
    }

    Widget hero({
      double textScale = 1,
      String? title,
      String trust = 'ضمان على كل شغلانة — لو في أي عيب بعد التسليم بنرجع نصلحه',
      int imageCount = 0,
      double width = 390,
    }) =>
        MaterialApp(
          theme: AppTheme.light(),
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Scaffold(
                body: SingleChildScrollView(
                  child: SizedBox(
                    width: width,
                    child: HomeHero(
                      // مفيش صور شبكة في الاختبار: `HeroImageCrossfade` بياخد قايمة فاضية
                      // فيرسم التدرّج الاحتياطي. النقط بتظهر بعدد الصور، فبنعدّيها كتكرار
                      // لنفس الـprovider لما نحتاج نختبرها.
                      images: List.generate(
                        imageCount,
                        (_) => const AssetImage('assets/nonexistent.png'),
                      ),
                      activeIndex: 0,
                      content: HomepageSearchContent.defaults.copyWithTitle(title),
                      trustMessage: trust,
                      onSearch: (_) {},
                    ),
                  ),
                ),
              ),
            ),
          ),
        );

    testWidgets('الحالة الافتراضية: مفيش استثناء رندر', (tester) async {
      expect(await renderAndCatch(tester, hero()), isNull);
    });

    testWidgets('تكبير خط النظام 1.6× (إتاحة): لسه مفيش overflow', (tester) async {
      expect(await renderAndCatch(tester, hero(textScale: 1.6)), isNull);
    });

    testWidgets('عنوان طويل جدًا من لوحة الأدمن: اللوحة بتكبر مش بتتقص', (tester) async {
      expect(
        await renderAndCatch(tester, hero(
          title: 'محتاج مساعدة في إيه النهارده في بيتك أو شقتك أو مكتبك؟ إحنا معاك',
        )),
        isNull,
      );
    });

    testWidgets('شاشة ضيقة (320px) + نقط شرائح: مفيش overflow', (tester) async {
      expect(await renderAndCatch(tester, hero(width: 320, imageCount: 3)), isNull);
    });

    // الحد الأدنى هو الوعد للمالك («سيب للصورة مساحة») — لو حد شاله بالغلط الشكل بيرجع
    // شريط رفيع زي ما كان.
    testWidgets('الارتفاع مش أقل من الحد الأدنى', (tester) async {
      await tester.pumpWidget(hero());
      expect(tester.getSize(find.byType(HomeHero)).height,
          greaterThanOrEqualTo(kHeroMinHeight));
    });

    // زرار البحث كان بيظهر بس بعد ما العميل يكتب — يعني أول نظرة مفيش مخرج واضح للبحث.
    testWidgets('زرار البحث ظاهر من غير ما العميل يكتب حاجة', (tester) async {
      await tester.pumpWidget(hero());
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
    });

    testWidgets('الكتابة + Enter بتبعت النص للبحث', (tester) async {
      String? searched;
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light(),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: HomeHero(
              images: const [],
              activeIndex: 0,
              content: HomepageSearchContent.defaults,
              trustMessage: '',
              onSearch: (value) => searched = value,
            ),
          ),
        ),
      ));
      await tester.enterText(find.byType(TextField), ' حنفية ');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(searched, 'حنفية');
    });
  });

  // docs/08 §76-د — «اللوجو اللي جوّاه الأكثر طلبًا حواليه إطار رمادي… أنا عايز اللوجو بس
  // وفي الصفحة طاير». الصف بيتحط في `SizedBox` بارتفاع محسوب، فهو نفس فئة بَقّة الـoverflow
  // اللي في اللوحة فوق — لازم يتقاس بنفس الطريقة.
  group('FeaturedCategoryItem — الأكثر طلبًا', () {
    Widget row(BuildContext Function()? capture, {double textScale = 1, String name = 'سباكة'}) =>
        MaterialApp(
          theme: AppTheme.light(),
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Scaffold(
                body: Builder(
                  builder: (context) => SizedBox(
                    height: featuredRowHeight(context),
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        FeaturedCategoryItem(category: _category(name), onTap: () {}),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );

    testWidgets('مفيش دايرة/إطار ورا الأيقونة لما فيه icon_url', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light(),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: FeaturedCategoryItem(
              category: _category('سباكة', image: 'https://example.test/i.png'),
              onTap: () {},
            ),
          ),
        ),
      ));
      // `CircleAvatar` كان بيرسم `surfaceContainerHighest` كخلفية دايرية — ده بالظبط
      // "الإطار الرمادي" اللي المالك شافه.
      expect(find.byType(CircleAvatar), findsNothing);
    });

    testWidgets('من غير أيقونة: حرف أول الاسم بيفضل ليه دايرة عشان يبان إنه زرار', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light(),
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            body: FeaturedCategoryItem(category: _category('نجارة'), onTap: () {}),
          ),
        ),
      ));
      expect(find.text('ن'), findsOneWidget);
    });

    testWidgets('الارتفاع المحجوز بيكبر مع خط النظام — مفيش overflow', (tester) async {
      await tester.pumpWidget(row(null, textScale: 1.6, name: 'خدمات منزلية'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('CustomerShell — الشريط السفلي', () {
    testWidgets('أربع تبويبات بالأسماء اللي المالك طلبها', (tester) async {
      expect(CustomerTab.values.map((t) => t.label).toList(), [
        'الرئيسية',
        'طلباتي',
        'ضماناتي',
        'حسابي',
      ]);
    });
  });

  // لقطة PNG حقيقية للأجزاء الجديدة — للفحص بالعين مش بالوصف (نفس منهجية §72).
  testWidgets('طباعة لقطة للشبكة (اختياري)', (tester) async {
    if (Platform.environment['FLUTTER_TEST_HOME_PNG'] != '1') return;
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final categories = [
      'سباكة', 'كهرباء', 'تكييف', 'نجارة', 'دهانات', 'تنظيف',
      'أجهزة منزلية', 'محارة وتشطيبات', 'مكافحة حشرات',
    ].map(_category).toList();

    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light(),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('كل الفئات', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                LayoutBuilder(
                  builder: (context, constraints) {
                    const columns = 3;
                    const spacing = 12.0;
                    final tileWidth = (constraints.maxWidth - spacing * (columns - 1)) / columns;
                    return GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        mainAxisSpacing: 16,
                        crossAxisSpacing: spacing,
                        childAspectRatio: tileWidth / (tileWidth + categoryTileLabelHeight(context)),
                      ),
                      itemCount: categories.length,
                      itemBuilder: (context, i) => CategoryTile(category: categories[i], onTap: () {}),
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('home_redesign_preview.png'));
  });
}
