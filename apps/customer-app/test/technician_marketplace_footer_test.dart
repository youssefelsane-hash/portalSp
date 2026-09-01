import 'package:customer_app/design/app_theme.dart';
import 'package:customer_app/features/technicians/technician_marketplace_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app({required double width, double textScale = 1}) => MaterialApp(
  theme: AppTheme.light(),
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
    child: Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: width,
            child: TechnicianMarketplaceCardFooter(
              priceLabel: '15800 ج.م.',
              isPremium: true,
              actions: [
                OutlinedButton(
                  onPressed: () {},
                  child: const Text('البروفايل'),
                ),
                FilledButton.tonal(
                  onPressed: () {},
                  child: const Text('جرّب 31/12 23:59'),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  ),
);

void main() {
  testWidgets('السعر وزر التوافر لا يعملان overflow على شاشة موبايل ضيقة', (
    tester,
  ) async {
    await tester.pumpWidget(_app(width: 300, textScale: 1.3));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('15800 ج.م.'), findsOneWidget);
    expect(find.text('جرّب 31/12 23:59'), findsOneWidget);
  });

  testWidgets('الـfooter يظل في صف مرتب عند توفر مساحة كافية', (tester) async {
    await tester.pumpWidget(_app(width: 560));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });
}
