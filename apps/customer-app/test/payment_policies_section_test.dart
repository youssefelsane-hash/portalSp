import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/payments/payment_policy.dart';

/// **القبول بيتسجّل بمعرّف نسخة لكل سياسة على حدة** — ده اللي بيفرّق المكوّن ده عن خانة واحدة
/// لكل الشروط (زي اللي في مسار التقسيط): الباك-إند بيقارن بالنسخة، فخانة واحدة كانت هتخلّينا
/// نسجّل موافقات متعددة والعميل شايف موافقة واحدة.
void main() {
  final policies = [
    const PaymentPolicy(
      policyId: 'p1',
      titleAr: 'شروط الدفع بعد الخدمة',
      bodyAr: 'نص الشروط الأول',
      isRequired: true,
      currentVersionId: 'v1',
    ),
    const PaymentPolicy(
      policyId: 'p2',
      titleAr: 'شروط اختيارية',
      bodyAr: 'نص الشروط التاني',
      isRequired: false,
      currentVersionId: 'v2',
    ),
  ];

  Widget harness(Set<String> accepted, ValueChanged<Set<String>> onChanged) =>
      MaterialApp(
        home: Scaffold(
          body: PaymentPoliciesSection(
            policies: policies,
            acceptedVersionIds: accepted,
            onChanged: onChanged,
          ),
        ),
      );

  testWidgets('كل سياسة ليها خانة مستقلة، والقبول بيرجّع معرّف النسخة', (tester) async {
    Set<String> accepted = <String>{};
    await tester.pumpWidget(harness(accepted, (next) => accepted = next));

    expect(find.byType(CheckboxListTile), findsNWidgets(2));
    expect(find.text('شروط الدفع بعد الخدمة'), findsOneWidget);

    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pump();
    expect(accepted, {'v1'}, reason: 'النسخة مش معرّف السياسة');

    await tester.pumpWidget(harness(accepted, (next) => accepted = next));
    await tester.tap(find.byType(CheckboxListTile).last);
    await tester.pump();
    expect(accepted, {'v1', 'v2'});

    // إلغاء الاختيار بيشيل النسخة دي بس
    await tester.pumpWidget(harness(accepted, (next) => accepted = next));
    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pump();
    expect(accepted, {'v2'});
  });

  testWidgets('نص الشروط مخفي لحد ما العميل يطلبه', (tester) async {
    await tester.pumpWidget(harness(<String>{}, (_) {}));
    expect(find.text('نص الشروط الأول'), findsNothing);

    await tester.tap(find.text('اقرأ الشروط').first);
    await tester.pump();
    expect(find.text('نص الشروط الأول'), findsOneWidget);
  });

  testWidgets('قايمة فاضية مابتعرضش أي حاجة', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PaymentPoliciesSection(
            policies: const [],
            acceptedVersionIds: const {},
            onChanged: (_) {},
          ),
        ),
      ),
    );
    expect(find.byType(CheckboxListTile), findsNothing);
  });
}
