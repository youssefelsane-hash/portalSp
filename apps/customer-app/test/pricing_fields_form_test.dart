// docs/08 §185 — الرسّام العام للحقول الديناميكية. الحالات هنا هي بند 28 من طلب المالك بالحرف:
// نص عربي طويل ومصطلح إنجليزي مابيعملوش overflow، الشرح كامل، ٣ اختيارات ظاهرة مش مستخبية،
// القيمة اللي بتروح للسيرفر هي هي، العدّاد الصحيح int بس، الـslider المتصل زي ما هو، ٢٠+ حقل
// من غير crash، والحقل الناقص بيتمرّر له والخطأ بيظهر تحته هو.
import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/pricing_field_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

PricingField _field(
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
  id: 'id-$key',
  fieldKey: key,
  displayOrder: order,
  labelAr: label,
  fieldType: type,
  isRequired: required,
  unitAr: unit,
  options: options
      ?.map((o) => PricingFieldOption(value: o.$1, labelAr: o.$2))
      .toList(),
  minValue: min,
  maxValue: max,
  minFiles: null,
  maxFiles: null,
  defaultValue: defaultValue,
);

class _Harness extends StatefulWidget {
  const _Harness({required this.fields, required this.log, this.controller, this.initial});

  final List<PricingField> fields;
  final List<(String, dynamic)> log;
  final PricingFieldsFormController? controller;
  final Map<String, dynamic>? initial;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  late final Map<String, dynamic> values = {...?widget.initial};

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: PricingFieldsForm(
            controller: widget.controller,
            fields: widget.fields,
            values: values,
            onChanged: (key, value) {
              widget.log.add((key, value));
              setState(() {
                if (value == null) {
                  values.remove(key);
                } else {
                  values[key] = value;
                }
              });
            },
          ),
        ),
      ),
    ),
  );
}

Future<List<(String, dynamic)>> _pump(
  WidgetTester tester,
  List<PricingField> fields, {
  double width = 320,
  PricingFieldsFormController? controller,
  Map<String, dynamic>? initial,
}) async {
  tester.view.physicalSize = Size(width, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final log = <(String, dynamic)>[];
  await tester.pumpWidget(
    _Harness(fields: fields, log: log, controller: controller, initial: initial),
  );
  return log;
}

const _laundryOptions = [
  ('iron_only', 'كي فقط'),
  ('wash_iron', 'غسيل + كي'),
  ('dry_clean_iron', 'دراي كلين + كي'),
];

void main() {
  testWidgets('عنوان عربي طويل جدًا + مصطلح إنجليزي على شاشة ٣٢٠: بيلف، مفيش overflow', (tester) async {
    const label =
        'عدد الغرف والصالات المطلوب تنظيفها بالكامل (Living room / Master bedroom / Reception) بما فيها الأرضيات';
    await _pump(tester, [
      _field('rooms', label, 'number', required: true),
      _field('dresses', 'عدد الفساتين (Dresses / Gowns)', 'slider', min: 0, max: 15),
    ]);
    // الإجباري عليه « *» في نفس السطر.
    expect(find.text('${bidiSafeText(label)} *', findRichText: true), findsOneWidget);
    // المقطع اللاتيني معزول اتجاهيًا (LRI…PDI) عشان مايتقسمش ويعكس القوس لما السطر يلف.
    expect(find.text(bidiSafeText('عدد الفساتين (Dresses / Gowns)'), findRichText: true), findsOneWidget);
    expect(bidiSafeText('عدد الفساتين (Dresses / Gowns)'), 'عدد الفساتين \u2066(Dresses / Gowns)\u2069');
    expect(bidiSafeText('تنظيف الفرن بعمق Deep cleaning'), 'تنظيف الفرن بعمق \u2066Deep cleaning\u2069');
    expect(bidiSafeText('بدون إنجليزي'), 'بدون إنجليزي');
    expect(tester.takeException(), isNull);
  });

  testWidgets('الشرح الطويل بيظهر كامل تحت السؤال (مش جوّه الـinput ومش مقصوص)', (tester) async {
    const helper =
        'سيتم استخدام نوع الخدمة الأساسي تلقائيًا. غيّر الاختيار هنا فقط لو عايز القمصان بخدمة مختلفة عن باقي الطلب.';
    await _pump(tester, [
      _field('shirts_type', 'نوع الخدمة للقمصان', 'dropdown', unit: '($helper)', options: _laundryOptions),
    ]);
    // بلا الأقواس اللي الأدمن حاططها — الشرح بيتقرا كجملة.
    expect(find.text(helper), findsOneWidget);
    final text = tester.widget<Text>(find.text(helper));
    expect(text.maxLines, isNull);
    expect(text.overflow, isNot(TextOverflow.ellipsis));
    expect(tester.takeException(), isNull);
  });

  testWidgets('وحدة قصيرة بتتكتب جنب القيمة، مش كشرح', (tester) async {
    await _pump(tester, [_field('shirts', 'عدد القمصان', 'slider', min: 0, max: 15, unit: 'قميص')]);
    expect(find.text('0 قميص'), findsOneWidget);
    expect(find.text('قميص'), findsNothing);
  });

  testWidgets('dropdown بتلات اختيارات: الاختيارات ظاهرة، مفيش DropdownButton', (tester) async {
    await _pump(tester, [
      _field('main_type', 'نوع الخدمة الأساسي', 'dropdown', required: true, options: _laundryOptions),
    ]);
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    for (final option in _laundryOptions) {
      expect(find.text(option.$2), findsOneWidget);
    }
  });

  testWidgets('القيمة اللي بتروح للسيرفر هي option.value بالظبط (wash_iron فضلت wash_iron)', (tester) async {
    final log = await _pump(tester, [
      _field('main_type', 'نوع الخدمة الأساسي', 'dropdown', required: true, options: _laundryOptions),
    ]);
    await tester.tap(find.text('غسيل + كي'));
    await tester.pump();
    expect(log.single, ('main_type', 'wash_iron'));
  });

  testWidgets('اختيارات كتير ⇒ bottom sheet بالقايمة كلها، والقيمة نفسها بتتبعت', (tester) async {
    final options = [for (var i = 1; i <= 12; i++) ('opt_$i', 'اختيار رقم $i بنص طويل شوية علشان يلف على سطرين')];
    final log = await _pump(tester, [
      _field('area', 'المنطقة', 'dropdown', required: true, options: options),
    ]);
    expect(find.text('اختيار رقم 1 بنص طويل شوية علشان يلف على سطرين'), findsNothing);
    await tester.tap(find.text('اختار من 12 اختيارات'));
    await tester.pumpAndSettle();
    // الـListView بيبني عناصر برّه الشاشة (cache extent)، فلازم تمرير فعلي لحد ما يبان.
    final item9 = find.text('اختيار رقم 9 بنص طويل شوية علشان يلف على سطرين');
    await tester.scrollUntilVisible(
      item9,
      80,
      scrollable: find.descendant(of: find.byType(BottomSheet), matching: find.byType(Scrollable)).first,
    );
    await tester.ensureVisible(item9);
    await tester.pumpAndSettle();
    await tester.tap(find.text('اختيار رقم 9 بنص طويل شوية علشان يلف على سطرين'));
    await tester.pumpAndSettle();
    expect(log.single, ('area', 'opt_9'));
    expect(find.text('اختيار رقم 9 بنص طويل شوية علشان يلف على سطرين'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('عدّاد صحيح 0–15: [-]/[+] وقيمة int بس، ومايعدّيش الحدود', (tester) async {
    final log = await _pump(tester, [_field('shirts', 'عدد القمصان', 'slider', min: 0, max: 15)]);
    expect(find.byType(Slider), findsNothing);
    await tester.tap(find.byTooltip('زوّد'));
    await tester.pump();
    await tester.tap(find.byTooltip('زوّد'));
    await tester.pump();
    await tester.tap(find.byTooltip('قلّل'));
    await tester.pump();
    expect(log.map((e) => e.$2).toList(), [1, 2, 1]);
    expect(log.every((e) => e.$2 is int), isTrue);
    expect(find.text('1'), findsOneWidget);

    // عند الحد الأدنى زرار «قلّل» مقفول — مفيش قيمة سالبة.
    await tester.tap(find.byTooltip('قلّل'));
    await tester.pump();
    final minus = tester.widget<IconButton>(
      find.ancestor(of: find.byIcon(Icons.remove), matching: find.byType(IconButton)),
    );
    expect(minus.onPressed, isNull);
  });

  testWidgets('عدّاد صحيح بمدى كبير (0–100): slider بدرجات، والسحب بيطلّع int مش 1.96…', (tester) async {
    final log = await _pump(tester, [_field('tiles', 'عدد البلاطات', 'slider', min: 0, max: 100)]);
    final slider = tester.widget<Slider>(find.byType(Slider));
    expect(slider.divisions, 100);
    await tester.drag(find.byType(Slider), const Offset(-37.3, 0));
    await tester.pump();
    expect(log, isNotEmpty);
    expect(log.every((e) => e.$2 is int), isTrue, reason: 'القيم: ${log.map((e) => e.$2)}');
  });

  testWidgets('slider متصل (حدود عشرية) بيفضل بسلوكه القديم', (tester) async {
    final log = await _pump(tester, [_field('thickness', 'السُمك', 'slider', min: 0.5, max: 10.5)]);
    final slider = tester.widget<Slider>(find.byType(Slider));
    expect(slider.divisions, isNull);
    await tester.drag(find.byType(Slider), const Offset(-40, 0));
    await tester.pump();
    expect(log.last.$2, isA<double>());
  });

  testWidgets('٢٥ حقل من كل الأنواع على ٣٢٠ بكسل: مفيش crash ولا overflow', (tester) async {
    final garments = ['القمصان', 'التيشيرتات', 'البناطيل والجينز (Jeans)', 'البلوزات', 'الفساتين (Dresses / Gowns)',
      'العبايات (Abayas)', 'البلوفرات / الكارديجان', 'الجيبات (Skirts)', 'البدل', 'الجاكيتات (Jackets / Blazers)',
      'الكوفرتات', 'الستاير'];
    final fields = <PricingField>[
      _field('main', 'نوع الخدمة الأساسي', 'dropdown', required: true, options: _laundryOptions, unit: '(الاختيار ده هيتطبق تلقائيًا على كل الملابس في الطلب.)'),
      for (final (i, g) in garments.indexed) ...[
        _field('count_$i', 'عدد $g', 'slider', order: i * 2 + 1, min: 0, max: 15, unit: '(حدد عدد $g في الطلب.)'),
        _field('type_$i', 'نوع الخدمة لـ$g', 'dropdown', order: i * 2 + 2,
            options: [('same_as_main', 'نفس الخدمة الأساسية'), ..._laundryOptions], defaultValue: 'same_as_main'),
      ],
      _field('express', 'تسليم مستعجل خلال ٢٤ ساعة (Express)', 'checkbox', order: 90),
    ];
    expect(fields.length, 26);
    await _pump(tester, fields);
    await tester.scrollUntilVisible(find.textContaining('تسليم مستعجل خلال', findRichText: true), 400);
    expect(tester.takeException(), isNull);
  });

  testWidgets('حقل اختياري بافتراضي مضبوط: الافتراضي ظاهر مختار، ومابيتبعتش لوحده', (tester) async {
    final log = await _pump(tester, [
      _field('shirts_type', 'نوع الخدمة للقمصان', 'dropdown',
          options: [('same_as_main', 'نفس الخدمة الأساسية'), ..._laundryOptions], defaultValue: 'same_as_main'),
    ]);
    final selectedRow = find.ancestor(of: find.text('نفس الخدمة الأساسية'), matching: find.byType(Row)).first;
    expect(find.descendant(of: selectedRow, matching: find.byIcon(Icons.radio_button_checked)), findsOneWidget);
    expect(find.byIcon(Icons.radio_button_checked), findsOneWidget);
    expect(log, isEmpty);
  });

  testWidgets('أرقام عربية في حقل الرقم بتتفهم', (tester) async {
    final log = await _pump(tester, [_field('area', 'المساحة', 'area', required: true, unit: 'م²')]);
    await tester.enterText(find.byType(TextField), '١٢٫٥');
    expect(log.last, ('area', 12.5));
    expect(parseLocalizedNumber('٣'), 3);
    expect(parseLocalizedNumber('abc'), isNull);
  });

  group('التحقق', () {
    testWidgets('حقل إجباري ناقص بعيد: تمرير له + الخطأ تحته + تركيز لو نص', (tester) async {
      final controller = PricingFieldsFormController();
      final fields = [
        for (var i = 0; i < 20; i++) _field('opt_$i', 'سؤال اختياري $i', 'slider', order: i, min: 0, max: 15),
        _field('rooms', 'عدد الغرف والصالات المطلوب تنظيفها', 'number', order: 50, required: true),
      ];
      await _pump(tester, fields, controller: controller);
      const label = 'عدد الغرف والصالات المطلوب تنظيفها *';
      expect(find.text(label, findRichText: true).hitTestable(), findsNothing);

      final missing = controller.revealFirstMissing();
      expect(missing?.fieldKey, 'rooms');
      await tester.pumpAndSettle();

      const message = 'اكتب «عدد الغرف والصالات المطلوب تنظيفها» علشان نقدر نحسب السعر.';
      expect(find.text(message), findsOneWidget);
      expect(find.text(message).hitTestable(), findsOneWidget);
      // الخطأ **تحت نفس الحقل**: بعد عنوانه وبعد الـinput بتاعه.
      final labelTop = tester.getTopLeft(find.text(label, findRichText: true)).dy;
      final inputTop = tester.getTopLeft(find.byType(TextField)).dy;
      final errorTop = tester.getTopLeft(find.text(message)).dy;
      expect(labelTop, lessThan(inputTop));
      expect(inputTop, lessThan(errorTop));
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'pricing-rooms');

      // أول ما العميل يكتب، الخطأ بيختفي.
      await tester.enterText(find.byType(TextField), '3');
      await tester.pump();
      expect(find.text(message), findsNothing);
      expect(controller.revealFirstMissing(), isNull);
    });

    testWidgets('الأول بترتيب العرض، والرسالة بتقول يعمل إيه في الاختيار', (tester) async {
      final controller = PricingFieldsFormController();
      await _pump(tester, [
        _field('b', 'عدد الأجهزة', 'number', order: 2, required: true),
        _field('a', 'نوع الخدمة الأساسي', 'dropdown', order: 1, required: true, options: _laundryOptions),
      ], controller: controller);
      controller.revealFirstMissing();
      await tester.pumpAndSettle();
      expect(find.text('اختار «نوع الخدمة الأساسي» علشان نقدر نحسب السعر.'), findsOneWidget);
      expect(find.textContaining('عدد الأجهزة»'), findsNothing);
    });

    testWidgets('عدّاد إجباري ما اتلمسش بيبان «—» مش صفر (السيرفر هيرفضه لو ماجاوبش)', (tester) async {
      final controller = PricingFieldsFormController();
      final log = await _pump(tester, [
        _field('rooms', 'عدد الغرف', 'slider', required: true, min: 0, max: 10),
      ], controller: controller);
      expect(find.text('—'), findsOneWidget);
      expect(controller.revealFirstMissing()?.fieldKey, 'rooms');
      await tester.pump();
      await tester.tap(find.byTooltip('قلّل'));
      await tester.pump();
      expect(log.single, ('rooms', 0));
      expect(controller.revealFirstMissing(), isNull);
    });

    test('نفس شرط الاكتمال القديم: الاختياري مش مطلوب، والصور بعددها', () {
      final optional = _field('x', 'x', 'number');
      final required = _field('y', 'y', 'number', required: true);
      expect(isPricingFieldComplete(optional, {}), isTrue);
      expect(isPricingFieldComplete(required, {}), isFalse);
      expect(isPricingFieldComplete(required, {'y': ''}), isFalse);
      expect(isPricingFieldComplete(required, {'y': 0}), isTrue);
    });
  });

  test('الشرح مقابل الوحدة بيتحدد بالطول، مش باسم خدمة', () {
    expect(pricingFieldInlineUnit(_field('a', 'a', 'number', unit: 'م²')), 'م²');
    expect(pricingFieldHelperText(_field('a', 'a', 'number', unit: 'م²')), isNull);
    expect(pricingFieldInlineUnit(_field('a', 'a', 'number', unit: 'حدد عدد البلوزات في الطلب.')), isNull);
    expect(pricingFieldHelperText(_field('a', 'a', 'number', unit: '(حدد عدد البلوزات في الطلب.)')), 'حدد عدد البلوزات في الطلب.');
    expect(pricingFieldHelperText(_field('a', 'a', 'number', unit: '   ')), isNull);
  });
}
