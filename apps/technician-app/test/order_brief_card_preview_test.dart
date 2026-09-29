// لقطة PNG **بخط عربي حقيقي** لكارت الطلب عند مقدم الخدمة (docs/08 §185) — مش golden مقارنة.
//
// `flutter test` بيرسم أي نص بخط Ahem (مربعات)، فاللقطة العادية مابتقولش حاجة عن التفاف
// العربي أو اختلاطه بالإنجليزي. هنا بنحمّل Noto Sans Arabic + Roboto + أيقونات Material من
// الجهاز، ونطبع لقطات للشاشة زي ما العميل هيشوفها (٣٩٠ منطقي، Dark Mode، RTL).
//
// متوقفة افتراضيًا عشان ماتعتمدش على خطوط الجهاز في CI:
//   OSTA_PREVIEW_DIR=/tmp/previews flutter test test/order_brief_card_preview_test.dart
// (على أوبونتو: `apt-get install fonts-noto-core` لو الخط مش موجود.)
import 'dart:io';
import 'dart:ui' as ui;

import 'package:technician_app/design/app_theme.dart';
import 'package:technician_app/features/orders/order.dart';
import 'package:technician_app/features/orders/order_brief_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

final _outDir = Platform.environment['OSTA_PREVIEW_DIR'];

Future<void> _loadFont(String family, List<String> paths) async {
  final loader = FontLoader(family);
  for (final path in paths) {
    final file = File(path);
    if (!file.existsSync()) continue;
    loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
  }
  await loader.load();
}

Future<void> _loadFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/flutter';
  const noto = '/usr/share/fonts/truetype/noto';
  await _loadFont('NotoSansArabic', ['$noto/NotoSansArabic-Regular.ttf', '$noto/NotoSansArabic-Bold.ttf']);
  await _loadFont('Roboto', [
    '$flutterRoot/bin/cache/artifacts/material_fonts/Roboto-Regular.ttf',
    '$flutterRoot/bin/cache/artifacts/material_fonts/Roboto-Bold.ttf',
  ]);
  await _loadFont('MaterialIcons', ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
}

ThemeData _withRealFonts(ThemeData base) => base.copyWith(
  textTheme: base.textTheme.apply(fontFamily: 'NotoSansArabic', fontFamilyFallback: const ['Roboto']),
);

Future<void> _snap(WidgetTester tester, String name) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('preview')));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    File('$_outDir/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}


Map<String, dynamic> _input(String key, String label, String value,
        {String? unit, String type = 'slider', bool required = false, bool isDefault = false}) =>
    {
      'key': key,
      'label': label,
      'value': value,
      'unit': unit,
      'field_type': type,
      'is_required': required,
      'is_default': isDefault,
      'integer_quantity': type == 'slider',
    };

void main() {
  setUpAll(() async {
    if (_outDir != null) await _loadFonts();
  });

  testWidgets('لقطة: كارت طلب المكوجي عند مقدم الخدمة', (tester) async {
    if (_outDir == null) return;
    tester.view.physicalSize = const Size(390 * 2, 1400 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final garments = ['القمصان', 'التيشيرتات', 'البناطيل', 'البلوزات', 'الفساتين (Dresses / Gowns)',
      'العبايات (Abayas)', 'البلوفرات', 'الجيبات (Skirts)', 'البدل', 'الجاكيتات (Jackets / Blazers)'];
    final order = Order.fromJson({
      'id': 'o', 'order_number': 'ORD-2026-000013', 'order_status': 'accepted',
      'cash_to_collect_cents': 39600, 'my_earning_cents': 28100, 'has_online_payment': false,
      'fully_paid_online': false, 'payment_status': 'pending', 'booking_mode': 'individual',
      'service_name_ar': 'المكوجي (غسيل وكي الملابس)', 'scheduled_at': '2026-09-29T13:00:00.000Z',
      'duration_minutes': 1,
      'customer_notes': 'الجرس مش شغال، كلمني قبل ما تطلع.',
      'customer_name': 'youssef hamdy', 'customer_phone': '+201000000005',
      'customer_inputs': [
        _input('main', 'نوع الخدمة الأساسي', 'غسيل + كي', type: 'dropdown', required: true),
        for (final (i, g) in garments.indexed) ...[
          _input('c$i', 'عدد $g', i == 0 ? '1.9639846991701237' : (i == 9 ? '2' : '0'),
              unit: i == 0 ? 'قميص' : 'حدد عدد $g في الطلب.', isDefault: i != 0 && i != 9),
          _input('t$i', 'نوع الخدمة لـ$g', i == 9 ? 'دراي كلين + كي' : 'نفس الخدمة الأساسية',
              type: 'dropdown', isDefault: i != 9),
        ],
      ],
      'address': {
        'street_name': 'شارع التعاونيات', 'landmark': 'جنب شركة الكهرباء', 'latitude': 30.05, 'longitude': 31.2,
        'building_number': '15', 'floor_number': '3', 'apartment_number': '7',
        'delivery_notes': 'البوابة الخلفية، الدور التالت يمين الأسانسير',
      },
    });
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _withRealFonts(AppTheme.dark()),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: RepaintBoundary(
          key: const ValueKey('preview'),
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: OrderBriefCard(order: order, onNavigate: () {}),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _snap(tester, 'technician-order-card');
  });
}
