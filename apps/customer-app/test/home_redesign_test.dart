import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/catalog/category_tile.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/trust_strip.dart';
import 'package:customer_app/features/shell/customer_shell.dart';

// docs/08 §75 — إعادة تصميم واجهة العميل. الاختبارات دي بتقيس **البنية الفعلية بعد الرندر**
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

  group('TrustStrip — شريط الضمان', () {
    testWidgets('من غير بيانات ضمان: البند بيختفي بدل ما يتعرض رقم مخترع', (tester) async {
      await tester.pumpWidget(wrap(const TrustStrip(warranty: null)));
      // الوعدين التانيين حقيقيين دايمًا، فبيفضلوا.
      expect(find.textContaining('السعر واضح'), findsOneWidget);
      expect(find.textContaining('متحقّق'), findsOneWidget);
      // بس مفيش أي كلام عن ضمان.
      expect(find.textContaining('ضمان'), findsNothing);
    });

    testWidgets('النص بييجي من السيرفر زي ما هو — مش مبني في التطبيق', (tester) async {
      await tester.pumpWidget(wrap(
        const TrustStrip(
          warranty: TrustInfo(warrantyDays: 365, warrantyLabelAr: 'ضمان سنة كاملة'),
        ),
      ));
      // لو الإدارة رفعت الضمان لسنة، النص بيتغيّر لوحده بلا نشر جديد للتطبيق.
      expect(find.text('ضمان سنة كاملة'), findsOneWidget);
      expect(find.textContaining('14'), findsNothing);
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
  testWidgets('طباعة لقطة للشبكة وشريط الضمان (اختياري)', (tester) async {
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
                const SizedBox(height: 24),
                const TrustStrip(
                  warranty: TrustInfo(warrantyDays: 14, warrantyLabelAr: 'ضمان 14 يوم'),
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
