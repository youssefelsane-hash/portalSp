import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/earnings/earnings_repository.dart';
import 'package:technician_app/features/earnings/payout_request_screen.dart';

class _UnusedRepository implements EarningsRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Widget _screen(int balanceCents) => MaterialApp(
  home: PayoutRequestScreen(
    repository: _UnusedRepository(),
    availableBalanceCents: balanceCents,
  ),
);

void main() {
  testWidgets('الرصيد السالب يظهر كمديونية ويمنع إرسال طلب صرف', (
    tester,
  ) async {
    await tester.pumpWidget(_screen(-1051900));

    expect(
      find.textContaining('عليك مديونية بقيمة 10519 ج.م.'),
      findsOneWidget,
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
  });

  testWidgets('المبلغ الأكبر من الرصيد يظهر validation واضح قبل الشبكة', (
    tester,
  ) async {
    await tester.pumpWidget(_screen(20000));
    await tester.enterText(find.byType(TextFormField).first, '201');
    await tester.tap(find.text('تأكيد طلب الصرف'));
    await tester.pump();

    expect(find.text('المبلغ أكبر من الرصيد المتاح'), findsOneWidget);
  });
}
