import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/design/network_image_box.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/service_card.dart';

// docs/08 §72 (بلاغ مالك: «الكلام كله متركز… الكلام مش متاخد بالطول») — كارت الخدمة اتغيّر من
// ListTile بصورة جانبية 56×56 لكارت صورة-فوق/كلام-تحت. الاختبار ده بيثبّت البنية الجديدة، و**كمان
// بيطبع صورة PNG حقيقية للكارت** (`FLUTTER_TEST_CARD_PNG=1`) عشان يتشاف بالعين مش بالوصف بس.
CatalogService _service({required String name, String? description, required String pricingModel}) =>
    CatalogService.fromJson({
      'id': 'svc-1',
      'category_id': 'cat-1',
      'name_ar': name,
      'short_description_ar': description,
      'icon_url': null,
      'pricing_model': pricingModel,
      'base_price_cents': 9000,
      'inspection_fee_cents': 0,
      'unit_name_ar': null,
      'warranty_days': 0,
      'allows_scheduling': true,
      'allows_emergency': false,
      'allows_individual': true,
      'allows_team': false,
      'allows_date_range_booking': false,
    });

void main() {
  const longName = 'تأسيس كهرباء كامل لشقة سكنية';
  const longDescription =
      'تأسيس كهرباء كامل لشقة سكنية شامل تمديد المواسير والأسلاك وتركيب علبة الكهرباء والمفاتيح، '
      'مع اختبار كل الخطوط قبل التسليم وضمان على الشغل.';

  Widget wrap(Widget child) => MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: child)),
        ),
      );

  testWidgets('الكارت بيعرض العنوان الطويل والوصف والسعر مع بعض', (tester) async {
    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: longName, description: longDescription, pricingModel: 'fixed'),
      priceLabel: '90.00 ج.م.',
      onTap: () {},
    )));

    expect(find.text(longName), findsOneWidget);
    expect(find.text(longDescription), findsOneWidget);
    expect(find.text('90.00 ج.م.'), findsOneWidget);
  });

  testWidgets('العنوان بياخد عرض الكارت كله — مش عمود ضيّق جنب الصورة', (tester) async {
    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: longName, description: longDescription, pricingModel: 'fixed'),
      priceLabel: '90.00 ج.م.',
      onTap: () {},
    )));

    final cardWidth = tester.getSize(find.byType(Card)).width;
    // البانر بياخد عرض الكارت كله (مش مربّع 56 على الجنب) — ده جوهر الشكل الجديد.
    expect(tester.getSize(find.byType(NetworkImageBox)).width, cardWidth);
    // ونسبته 3:1 — عريض وواطي، مش صورة كبيرة بتاكل الشاشة.
    expect(tester.getSize(find.byType(NetworkImageBox)).height, closeTo(cardWidth / 3, 1));
    // والكلام تحت الصورة، مش جنبها.
    final bannerBottom = tester.getBottomLeft(find.byType(NetworkImageBox)).dy;
    expect(tester.getTopLeft(find.text(longName)).dy, greaterThanOrEqualTo(bannerBottom));
    // سطر السعر تحت العنوان بعرض المنطقة الداخلية كلها (14 حشو من كل ناحية).
    expect(tester.getSize(find.text('90.00 ج.م.')).width, closeTo(cardWidth - 28 - 20, 2));
  });

  testWidgets('خدمة formula بتعرض "يُحسب حسب التفاصيل" مكان السعر', (tester) async {
    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: 'تأسيس كهرباء', description: null, pricingModel: 'formula'),
      priceLabel: 'يُحسب حسب التفاصيل',
      onTap: () {},
    )));
    expect(find.text('يُحسب حسب التفاصيل'), findsOneWidget);
  });

  testWidgets('خدمة بلا وصف: الكارت بيتقفل من غير سطر فاضي', (tester) async {
    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: 'تركيب لمبة', description: null, pricingModel: 'fixed'),
      priceLabel: '90.00 ج.م.',
      onTap: () {},
    )));
    final withoutDescription = tester.getSize(find.byType(Card)).height;

    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: 'تركيب لمبة', description: longDescription, pricingModel: 'fixed'),
      priceLabel: '90.00 ج.م.',
      onTap: () {},
    )));
    final withDescription = tester.getSize(find.byType(Card)).height;

    expect(withDescription, greaterThan(withoutDescription));
  });

  testWidgets('الضغط على الكارت بيفتح الخدمة', (tester) async {
    var tapped = false;
    await tester.pumpWidget(wrap(ServiceCard(
      service: _service(name: longName, description: longDescription, pricingModel: 'fixed'),
      priceLabel: '90.00 ج.م.',
      onTap: () => tapped = true,
    )));
    await tester.tap(find.byType(ServiceCard));
    expect(tapped, isTrue);
  });

  // لقطة حقيقية للكارت (مش golden مقارنة — طباعة للفحص البصري بالعين). بتشتغل بس لما المتغيّر
  // متظبّط عشان ما تبطّأش تشغيل الاختبارات العادي.
  testWidgets('طباعة لقطة PNG للكارت (اختياري)', (tester) async {
    if (Platform.environment['FLUTTER_TEST_CARD_PNG'] != '1') return;
    // مقاس موبايل حقيقي — الكارت المفروض يتشاف زي ما العميل هيشوفه، مش على سطح 800×600.
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(wrap(
      ListView(children: [
        ServiceCard(
          service: _service(name: longName, description: longDescription, pricingModel: 'formula'),
          priceLabel: 'يُحسب حسب التفاصيل',
          onTap: () {},
        ),
        const SizedBox(height: 12),
        ServiceCard(
          service: _service(name: 'تركيب لمبة', description: 'تركيب لمبة أو أباجورة مكان جاهز.', pricingModel: 'fixed'),
          priceLabel: '90.00 ج.م.',
          onTap: () {},
        ),
      ]),
    ));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('service_card_preview.png'));
  });
}
