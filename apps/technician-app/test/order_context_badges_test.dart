import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/order.dart';
import 'package:technician_app/features/orders/order_context_badges.dart';

Order _order(String type) => Order.fromJson({
  'id': 'o1',
  'order_number': 'P7-001',
  'order_status': 'accepted',
  'order_type': type,
  'payment_status': 'unpaid',
  'booking_mode': 'individual',
});

void main() {
  test('الموديل بيقرا order_type صح من رد الـAPI', () {
    expect(_order('recurring').isRecurring, isTrue);
    expect(_order('recurring').isWarrantyRevisit, isFalse);
    expect(_order('revisit').isWarrantyRevisit, isTrue);
    expect(_order('revisit').isRecurring, isFalse);
    expect(_order('standard').isRecurring, isFalse);
    expect(_order('standard').isWarrantyRevisit, isFalse);
  });

  test('حقل ناقص من API قديم = طلب عادي، مش استثناء', () {
    final o = Order.fromJson({
      'id': 'o1', 'order_number': 'P7-002', 'order_status': 'accepted',
      'payment_status': 'unpaid', 'booking_mode': 'individual',
    });
    expect(o.orderType, 'standard');
    expect(o.isRecurring, isFalse);
    expect(o.isWarrantyRevisit, isFalse);
  });

  test('الطلب العادي مابياخدش أي شارة', () {
    expect(orderContextBadges(isRecurring: false, isWarrantyRevisit: false), isEmpty);
  });

  testWidgets('شارة «متكرر» بتظهر بنصها', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Row(children: orderContextBadges(
        isRecurring: true, isWarrantyRevisit: false))),
    ));
    expect(find.text('متكرر'), findsOneWidget);
    expect(find.text('ضمان'), findsNothing);
  });

  testWidgets('شارة «ضمان» بتظهر بنصها', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Row(children: orderContextBadges(
        isRecurring: false, isWarrantyRevisit: true))),
    ));
    expect(find.text('ضمان'), findsOneWidget);
    expect(find.text('متكرر'), findsNothing);
  });

  testWidgets('لقطة للشارتين جنب بعض', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        backgroundColor: const Color(0xFF121212),
        body: Center(child: Directionality(
          textDirection: TextDirection.rtl,
          child: Wrap(spacing: 8, children: [
            ...orderContextBadges(isRecurring: true, isWarrantyRevisit: false),
            ...orderContextBadges(isRecurring: false, isWarrantyRevisit: true),
          ]),
        )),
      ),
    ));
    expect(find.text('متكرر'), findsOneWidget);
    expect(find.text('ضمان'), findsOneWidget);
  });
}
