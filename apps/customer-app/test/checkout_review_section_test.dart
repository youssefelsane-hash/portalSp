import 'package:customer_app/features/catalog/models.dart';
import 'package:customer_app/features/catalog/pricing_field_widgets.dart';
import 'package:customer_app/features/orders/checkout_review_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

PricingField _field(
  String key, {
  bool required = false,
  bool supported = true,
}) => PricingField(
  id: key,
  fieldKey: key,
  displayOrder: 0,
  labelAr: 'عدد القمصان',
  fieldType: supported ? 'number' : 'location',
  isRequired: required,
  unitAr: null,
  options: null,
  minValue: null,
  maxValue: null,
  minFiles: null,
  maxFiles: null,
);

class _ReviewHarness extends StatefulWidget {
  const _ReviewHarness();

  @override
  State<_ReviewHarness> createState() => _ReviewHarnessState();
}

class _ReviewHarnessState extends State<_ReviewHarness> {
  bool expanded = false;
  final values = <String, dynamic>{'shirts': 2};

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: SingleChildScrollView(
          child: CheckoutReviewSection(
            expanded: expanded,
            complete: true,
            onToggle: () => setState(() => expanded = !expanded),
            child: PricingFieldsForm(
              fields: [_field('shirts', required: true)],
              values: values,
              onChanged: (key, value) => setState(() => values[key] = value),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  test('review folds only existing, complete, supported answers', () {
    final fields = [_field('shirts', required: true)];
    expect(
      shouldCollapseCheckoutReview(
        previousAnswers: {'shirts': 2},
        fields: fields,
        values: {'shirts': 2},
      ),
      isTrue,
    );
    expect(
      shouldCollapseCheckoutReview(
        previousAnswers: null,
        fields: fields,
        values: {'shirts': 2},
      ),
      isFalse,
    );
    expect(
      shouldCollapseCheckoutReview(
        previousAnswers: {'other': 1},
        fields: fields,
        values: {'other': 1},
      ),
      isFalse,
    );
    expect(
      shouldCollapseCheckoutReview(
        previousAnswers: {'location': 'x'},
        fields: [_field('location', required: true, supported: false)],
        values: {'location': 'x'},
      ),
      isFalse,
    );
  });

  testWidgets('details stay editable and retain answers after closing', (
    tester,
  ) async {
    await tester.pumpWidget(const _ReviewHarness());
    expect(find.text('عدد القمصان'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('checkout-review-toggle')));
    await tester.pump();
    expect(find.text('عدد القمصان *', findRichText: true), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '2',
    );

    await tester.enterText(find.byType(TextField), '5');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('checkout-review-toggle')));
    await tester.pump();
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.byKey(const ValueKey('checkout-review-toggle')));
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '5',
    );
    expect(
      tester
          .state<_ReviewHarnessState>(find.byType(_ReviewHarness))
          .values['shirts'],
      5,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('review toggle fits a narrow screen with larger text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.platformDispatcher.textScaleFactorTestValue = 1.5;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(const _ReviewHarness());
    expect(find.text('اضغط السهم لو عايز تراجع أو تعدّل'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('incomplete details ask for the missing data', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CheckoutReviewSection(
            expanded: true,
            complete: false,
            onToggle: () {},
            child: const Text('السؤال المطلوب'),
          ),
        ),
      ),
    );
    expect(find.text('كمّل البيانات المطلوبة'), findsOneWidget);
    expect(find.text('السؤال المطلوب'), findsOneWidget);
  });

  testWidgets(
    'payment focus scrolls into view only before customer interaction',
    (tester) async {
      final paymentKey = GlobalKey();
      var interacted = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: Column(
                children: [
                  const SizedBox(height: 950),
                  Text('طريقة الدفع', key: paymentKey),
                  const SizedBox(height: 500),
                ],
              ),
            ),
          ),
        ),
      );
      expect(tester.getTopLeft(find.text('طريقة الدفع')).dy, greaterThan(800));
      final scrollable = Scrollable.maybeOf(paymentKey.currentContext!);
      expect(scrollable, isNotNull);
      expect(scrollable!.position.maxScrollExtent, greaterThan(0));
      focusCheckoutPayment(paymentKey, userInteracted: () => interacted);
      interacted = true;
      await tester.pumpAndSettle();
      expect(tester.getTopLeft(find.text('طريقة الدفع')).dy, greaterThan(800));

      interacted = false;
      var checks = 0;
      focusCheckoutPayment(
        paymentKey,
        userInteracted: () {
          checks++;
          return interacted;
        },
      );
      await tester.pump();
      await tester.pumpAndSettle();
      expect(checks, greaterThan(0));
      expect(tester.getTopLeft(find.text('طريقة الدفع')).dy, lessThan(250));
    },
  );

  testWidgets('payment focus honors reduced motion', (tester) async {
    final paymentKey = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
          body: SingleChildScrollView(
            child: Column(
              children: [
                const SizedBox(height: 950),
                Text('طريقة الدفع', key: paymentKey),
                const SizedBox(height: 500),
              ],
            ),
          ),
        ),
      ),
    );
    focusCheckoutPayment(paymentKey, userInteracted: () => false);
    await tester.pump();
    expect(tester.getTopLeft(find.text('طريقة الدفع')).dy, lessThan(250));
  });
}
