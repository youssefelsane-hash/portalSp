// لقطات PNG **بخط عربي حقيقي** للمراجعة البصرية (docs/08 §185) — مش golden مقارنة.
//
// `flutter test` بيرسم أي نص بخط Ahem (مربعات)، فاللقطة العادية مابتقولش حاجة عن التفاف
// العربي أو اختلاطه بالإنجليزي. هنا بنحمّل Noto Sans Arabic + Roboto + أيقونات Material من
// الجهاز، ونطبع لقطات للشاشة زي ما العميل هيشوفها (٣٩٠ منطقي، Dark Mode، RTL).
//
// متوقفة افتراضيًا عشان ماتعتمدش على خطوط الجهاز في CI:
//   OSTA_PREVIEW_DIR=/tmp/previews flutter test test/pricing_fields_preview_test.dart
// (على أوبونتو: `apt-get install fonts-noto-core` لو الخط مش موجود.)
import 'dart:io';
import 'dart:ui' as ui;

import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/pricing_field_widgets.dart';
import 'package:customer_app/features/orders/booking_time_picker.dart';
import 'package:customer_app/features/orders/booking_window.dart';
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

PricingField _f(
  String key,
  String label,
  String type, {
  int order = 0,
  bool required = false,
  String? unit,
  List<(String, String)>? options,
  num? min,
  num? max,
  String? defaultValue,
}) => PricingField(
  id: key,
  fieldKey: key,
  displayOrder: order,
  labelAr: label,
  fieldType: type,
  isRequired: required,
  unitAr: unit,
  options: options?.map((o) => PricingFieldOption(value: o.$1, labelAr: o.$2)).toList(),
  minValue: min,
  maxValue: max,
  minFiles: null,
  maxFiles: null,
  defaultValue: defaultValue,
);

const _types = [('iron_only', 'كي فقط'), ('wash_iron', 'غسيل + كي'), ('dry_clean_iron', 'دراي كلين + كي')];

List<PricingField> _laundry() => [
  _f('main', 'نوع الخدمة الأساسي', 'dropdown', required: true, options: _types,
      unit: '(الاختيار ده هيتطبق تلقائيًا على كل الملابس في الطلب. لو عايز نوع معين من الملابس بخدمة مختلفة، تقدر تغيّره من الاختيار الخاص بيه تحت.)'),
  _f('shirts', 'عدد القمصان', 'slider', order: 1, min: 0, max: 15, unit: 'قميص'),
  _f('shirts_type', 'نوع الخدمة للقمصان', 'dropdown', order: 2, defaultValue: 'same',
      options: [('same', 'نفس الخدمة الأساسية'), ..._types],
      unit: '(سيتم استخدام نوع الخدمة الأساسي تلقائيًا. غيّر الاختيار هنا فقط لو عايز القمصان بخدمة مختلفة عن باقي الطلب.)'),
  _f('dresses', 'عدد الفساتين (Dresses / Gowns)', 'slider', order: 3, min: 0, max: 15, unit: '(حدد عدد الفساتين في الطلب.)'),
  _f('area', 'إجمالي مساحة السجاد المطلوب تنظيفه (بالمتر المربع)', 'area', order: 4, required: true, unit: 'م²'),
  _f('district', 'المنطقة', 'dropdown', order: 5, options: [for (var i = 1; i <= 9; i++) ('d$i', 'منطقة رقم $i')]),
  _f('fridge', 'تنظيف الثلاجة من الداخل', 'checkbox', order: 6),
  _f('oven', 'تنظيف الفرن والبوتاجاز بعمق (Deep cleaning)', 'checkbox', order: 7),
];

Widget _frame({required Widget child, required ThemeData theme}) => MaterialApp(
  debugShowCheckedModeBanner: false,
  theme: theme,
  home: Directionality(
    textDirection: TextDirection.rtl,
    child: RepaintBoundary(key: const ValueKey('preview'), child: child),
  ),
);

void main() {
  setUpAll(() async {
    if (_outDir != null) await _loadFonts();
  });

  testWidgets('لقطة: فورم المكوجي — Dark', (tester) async {
    if (_outDir == null) return;
    tester.view.physicalSize = const Size(390 * 2, 1900 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    final values = <String, dynamic>{'main': 'wash_iron', 'shirts': 2};
    final controller = PricingFieldsFormController();
    await tester.pumpWidget(_frame(
      theme: _withRealFonts(AppTheme.dark()),
      child: Scaffold(
        appBar: AppBar(title: const Text('تفاصيل الشغل: المكوجي (غسيل وكي الملابس)')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Builder(builder: (context) => Text('حدد تفاصيل طلبك', style: Theme.of(context).textTheme.titleMedium)),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: PricingFieldsForm(
                    controller: controller,
                    fields: _laundry(),
                    values: values,
                    onChanged: (_, _) {},
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _snap(tester, 'customer-dynamic-fields-dark');

    controller.revealFirstMissing();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await _snap(tester, 'customer-dynamic-fields-missing');
    await tester.pumpAndSettle(const Duration(seconds: 2));
  });

  testWidgets('لقطة: فورم التنظيف — Light', (tester) async {
    if (_outDir == null) return;
    tester.view.physicalSize = const Size(360 * 2, 1000 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_frame(
      theme: _withRealFonts(AppTheme.light()),
      child: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: PricingFieldsForm(
            fields: [
              _f('rooms', 'عدد الغرف والصالات المطلوب تنظيفها', 'slider', required: true, min: 0, max: 12,
                  unit: '(الغرفة أو الصالة تُحسب كوحدة واحدة.)'),
              _f('baths', 'عدد الحمامات المطلوب تنظيفها', 'slider', order: 1, min: 0, max: 6, unit: 'حمام'),
              _f('last_clean', 'هل الأماكن المطلوبة اتنضفت تنظيف كامل خلال آخر 3 شهور؟', 'dropdown', order: 2,
                  required: true, options: [('yes', 'أيوه'), ('no', 'لأ')]),
            ],
            values: const {'baths': 2},
            onChanged: (_, _) {},
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _snap(tester, 'customer-cleaning-light');
  });

  testWidgets('لقطة: منتقي وقت البداية المحصور', (tester) async {
    if (_outDir == null) return;
    tester.view.physicalSize = const Size(390 * 2, 560 * 2);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_frame(
      theme: _withRealFonts(AppTheme.dark()),
      child: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: BookingTimePickerSheet(
            window: BookingWindow.fromJson({'start_hour': 5, 'end_hour': 19}),
            initial: const TimeOfDay(hour: 16, minute: 30),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await _snap(tester, 'customer-booking-time-picker');
  });
}
