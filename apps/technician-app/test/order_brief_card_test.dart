// docs/08 §185 — كارت الطلب عند مقدم الخدمة: اختيارات العميل كقايمة مفلترة بالـmetadata،
// العنوان الكامل، ملاحظات العميل، وعدم عرض مدة الجدولة التشغيلية. الحالات هنا هي بالظبط
// اللي المالك طلبها (بند 29): ٢٠ اختيار منهم ٢ بس فعليين، طلب قديم بلا metadata، عنوان كامل
// وعنوان قديم، ملاحظات موجودة/مش موجودة، والملاحة بالإحداثيات.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/order.dart';
import 'package:technician_app/features/orders/order_brief_card.dart';

Map<String, dynamic> _orderJson({
  Object? customerInputs,
  Map<String, dynamic>? address,
  String? customerNotes,
  int? durationMinutes,
}) => {
  'id': 'order-1',
  'order_number': 'ORD-2026-000013',
  'order_status': 'accepted',
  'cash_to_collect_cents': 39600,
  'my_earning_cents': 28100,
  'has_online_payment': false,
  'fully_paid_online': false,
  'payment_status': 'pending',
  'booking_mode': 'individual',
  'service_name_ar': 'المكوجي (غسيل وكي الملابس)',
  'scheduled_at': '2026-09-29T13:00:00.000Z',
  'problem_description': null,
  'customer_notes': customerNotes,
  'customer_inputs': customerInputs,
  'customer_name': 'youssef hamdy',
  'customer_phone': '+201000000005',
  'duration_minutes': durationMinutes,
  'address': ?address,
};

Map<String, dynamic> _input(
  String key,
  String label,
  String value, {
  String? unit,
  String type = 'slider',
  bool required = false,
  bool isDefault = false,
  bool integer = true,
}) => {
  'key': key,
  'label': label,
  'value': value,
  'unit': unit,
  'field_type': type,
  'is_required': required,
  'is_default': isDefault,
  'integer_quantity': type == 'slider' ? integer : false,
};

/// خدمة المكوجي زي ما هي في اللقطات: نوع أساسي + ١٠ أصناف × (عدد + نوع خدمة) — ٢١ بند،
/// العميل غيّر منهم تلاتة بس.
List<Map<String, dynamic>> _laundryInputs() {
  final garments = [
    'القمصان', 'التيشيرتات', 'البناطيل', 'البلوزات', 'الفساتين (Dresses / Gowns)',
    'العبايات (Abayas)', 'البلوفرات', 'الجيبات (Skirts)', 'البدل', 'الجاكيتات (Jackets / Blazers)',
  ];
  return [
    _input('main_type', 'نوع الخدمة الأساسي', 'غسيل + كي', type: 'dropdown', required: true),
    for (final (index, garment) in garments.indexed) ...[
      _input(
        'count_$index',
        'عدد $garment',
        index == 0 ? '1.9639846991701237' : (index == 9 ? '2' : '0'),
        // شرح الأدمن الطويل اللي كان بيتعرض كوحدة («0 حدد إجمالي عدد…»).
        unit: index == 0 ? 'قميص' : 'حدد إجمالي عدد $garment في الطلب.',
        isDefault: index != 0 && index != 9,
      ),
      _input(
        'type_$index',
        'نوع الخدمة لـ$garment',
        index == 9 ? 'دراي كلين + كي' : 'نفس الخدمة الأساسية',
        type: 'dropdown',
        isDefault: index != 9,
      ),
    ],
  ];
}

Future<void> _pump(WidgetTester tester, Order order, {VoidCallback? onNavigate}) async {
  tester.view.physicalSize = const Size(360 * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: SingleChildScrollView(
            child: OrderBriefCard(order: order, onNavigate: onNavigate),
          ),
        ),
      ),
    ),
  );
}

void main() {
  group('اختيارات العميل', () {
    testWidgets('٢١ اختيار منهم ٣ فعليين ⇒ ملخص قصير، والقيم المهمة ظاهرة', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson(customerInputs: _laundryInputs())));

      expect(find.text('اختيارات العميل'), findsOneWidget);
      expect(find.text('غسيل + كي'), findsOneWidget);
      // الكسر القديم بيتقرّب لأن الـmetadata بتقول إنه عدّاد صحيح.
      expect(find.text('2 قميص'), findsOneWidget);
      expect(find.textContaining('1.96398'), findsNothing);
      expect(find.text('دراي كلين + كي'), findsOneWidget);
      // الأصفار الافتراضية و«نفس الخدمة الأساسية» مش مالية الشاشة.
      expect(find.text('نفس الخدمة الأساسية'), findsNothing);
      expect(find.text('عدد التيشيرتات'), findsNothing);
      // والشرح الطويل ماينفعش يتعرض كوحدة جنب الرقم.
      expect(find.textContaining('حدد إجمالي عدد'), findsNothing);
      expect(find.text('عرض كل الاختيارات (21)'), findsOneWidget);
    });

    testWidgets('«عرض الكل» بيجيب الافتراضي كمان — مخفي مش ممسوح', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson(customerInputs: _laundryInputs())));
      await tester.tap(find.text('عرض كل الاختيارات (21)'));
      await tester.pump();
      expect(find.text('على الإعداد الافتراضي'), findsOneWidget);
      expect(find.text('نفس الخدمة الأساسية'), findsNWidgets(9));
      expect(find.text('عدد التيشيرتات'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('صفر في حقل إجباري مش ضوضاء — مابيختفيش', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            customerInputs: [
              _input('rooms', 'عدد الغرف', '0', type: 'number', required: true),
            ],
          ),
        ),
      );
      expect(find.text('عدد الغرف'), findsOneWidget);
      expect(find.text('0'), findsOneWidget);
    });

    testWidgets('طلب قديم بلا metadata: مفيش crash، والقيم زي ما هي، ومطوي بعد ٦', (tester) async {
      final legacy = [
        for (var i = 0; i < 10; i++)
          {'key': 'k$i', 'label': 'سؤال $i', 'value': i == 0 ? '1.5482365145228194' : '$i', 'unit': null},
      ];
      await _pump(tester, Order.fromJson(_orderJson(customerInputs: legacy)));
      // من غير علامة «عدّاد صحيح» القيمة التاريخية بتتعرض بالظبط — مفيش تخمين.
      expect(find.text('1.5482365145228194'), findsOneWidget);
      expect(find.text('سؤال 5'), findsOneWidget);
      expect(find.text('سؤال 6'), findsNothing);
      expect(find.text('عرض كل الاختيارات (10)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('قيم مش نصوص ومداخل بايظة في الـsnapshot مابتوقعش الشاشة', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            customerInputs: [
              {'key': 'a', 'label': 'المساحة', 'value': 25, 'unit': 'م²'},
              'garbage',
              {'label': '', 'value': 'x'},
            ],
          ),
        ),
      );
      expect(find.text('25 م²'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('خدمة بلا حقول ديناميكية ⇒ مفيش قسم فاضي', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson()));
      expect(find.text('اختيارات العميل'), findsNothing);
    });
  });

  group('العنوان', () {
    final full = {
      'street_name': 'شارع التعاونيات',
      'landmark': 'جنب شركة الكهرباء',
      'latitude': 30.05,
      'longitude': 31.2,
      'building_number': '15',
      'floor_number': '3',
      'apartment_number': '7',
      'delivery_notes': 'الجرس مش شغال، كلمني قبل ما تطلع',
    };

    testWidgets('عنوان كامل: الشارع + العمارة/الدور/الشقة + العلامة + ملاحظات الوصول', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson(address: full)));
      expect(find.text('شارع التعاونيات'), findsOneWidget);
      expect(find.text('عمارة 15 · الدور 3 · شقة 7'), findsOneWidget);
      expect(find.text('علامة مميزة'), findsOneWidget);
      expect(find.text('جنب شركة الكهرباء'), findsOneWidget);
      expect(find.text('ملاحظات الوصول'), findsOneWidget);
      expect(find.text('الجرس مش شغال، كلمني قبل ما تطلع'), findsOneWidget);
    });

    testWidgets('عنوان قديم (شارع + علامة بس): مفيش صفوف فاضية', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            address: {
              'street_name': 'شارع التعاونيات',
              'landmark': 'جنب شركة الكهرباء',
              'latitude': 30.05,
              'longitude': 31.2,
            },
          ),
        ),
      );
      expect(find.text('شارع التعاونيات'), findsOneWidget);
      expect(find.text('جنب شركة الكهرباء'), findsOneWidget);
      expect(find.textContaining('عمارة'), findsNothing);
      expect(find.text('ملاحظات الوصول'), findsNothing);
      expect(find.text('المستلم في العنوان'), findsNothing);
    });

    testWidgets('قيم null أو مسافات ⇒ مفيش labels فاضية', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            address: {
              ...full,
              'landmark': '  ',
              'building_number': null,
              'floor_number': '',
              'apartment_number': null,
              'delivery_notes': null,
            },
          ),
        ),
      );
      expect(find.text('علامة مميزة'), findsNothing);
      expect(find.text('ملاحظات الوصول'), findsNothing);
      expect(find.textContaining('الدور'), findsNothing);
    });

    testWidgets('المستلم في العنوان بيظهر لما السيرفر يبعته (سياسة الظهور على السيرفر)', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            address: {...full, 'contact_name': 'مدام سعاد', 'contact_phone': '+201011111111'},
          ),
        ),
      );
      expect(find.text('المستلم في العنوان'), findsOneWidget);
      expect(find.text('مدام سعاد'), findsOneWidget);
      expect(find.text('+201011111111'), findsOneWidget);
    });

    testWidgets('الملاحة بالإحداثيات، وزرارها بينادي الـcallback', (tester) async {
      var tapped = 0;
      final order = Order.fromJson(_orderJson(address: full));
      expect(
        order.address!.navigationUri.toString(),
        'https://www.google.com/maps/dir/?api=1&destination=30.05,31.2',
      );
      await _pump(tester, order, onNavigate: () => tapped++);
      await tester.tap(find.text('افتح الملاحة للعنوان'));
      expect(tapped, 1);
    });
  });

  group('ملاحظات العميل والمدة والترتيب', () {
    testWidgets('ملاحظات العميل بتظهر بس لو موجودة', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson(customerNotes: 'الجرس مش شغال، كلمني قبل ما تطلع.')));
      expect(find.text('ملاحظات العميل'), findsOneWidget);
      expect(find.text('الجرس مش شغال، كلمني قبل ما تطلع.'), findsOneWidget);

      await _pump(tester, Order.fromJson(_orderJson(customerNotes: '   ')));
      expect(find.text('ملاحظات العميل'), findsNothing);
    });

    testWidgets('مدة الجدولة التشغيلية (1 دقيقة) مابتتعرضش كمدة تنفيذ', (tester) async {
      await _pump(tester, Order.fromJson(_orderJson(durationMinutes: 1)));
      expect(find.textContaining('المدة المتوقعة'), findsNothing);

      await _pump(tester, Order.fromJson(_orderJson(durationMinutes: 120)));
      expect(find.text('المدة المتوقعة للتنفيذ: ساعتان'), findsOneWidget);
    });

    testWidgets('الترتيب: الخدمة ← الموعد ← الاختيارات ← الملاحظات ← العميل ← العنوان', (tester) async {
      await _pump(
        tester,
        Order.fromJson(
          _orderJson(
            customerInputs: _laundryInputs(),
            customerNotes: 'ملاحظة',
            address: {'street_name': 'شارع التعاونيات', 'landmark': null, 'latitude': 30.0, 'longitude': 31.0},
          ),
        ),
      );
      double top(String text) => tester.getTopLeft(find.text(text)).dy;
      expect(top('المكوجي (غسيل وكي الملابس)'), lessThan(top('اختيارات العميل')));
      expect(top('اختيارات العميل'), lessThan(top('ملاحظات العميل')));
      expect(top('ملاحظات العميل'), lessThan(top('بيانات العميل')));
      expect(top('بيانات العميل'), lessThan(top('العنوان')));
    });
  });
}
