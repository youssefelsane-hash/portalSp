import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/pricing_field_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('long field explanation wraps on a narrow phone screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final explanation = List.filled(
      3,
      'بننظف كل غرفة على حدة، وبعدها نراجع الأرضيات والأسطح مع العميل. ',
    ).join().trim();
    final field = PricingField(
      id: 'field-1',
      fieldKey: 'rooms',
      displayOrder: 0,
      labelAr: 'عدد الغرف',
      fieldType: 'number',
      isRequired: true,
      unitAr: explanation,
      options: null,
      minValue: null,
      maxValue: null,
      minFiles: null,
      maxFiles: null,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => SingleChildScrollView(
              child: buildPricingFieldWidget(context, field, {}, (_, _) {}),
            ),
          ),
        ),
      ),
    );

    // الشرح بيتعرض كامل تحت عنوان السؤال، من غير أقواس ومن غير ما يتحشر جوّه الـinput
    // (docs/08 §185).
    expect(find.text(explanation), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
