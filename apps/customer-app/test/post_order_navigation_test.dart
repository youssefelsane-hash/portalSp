// بعد نجاح الطلب، مكدّس الحجز لازم يتنضّف (بلاغ المالك 2026-09-11).
//
// «علشان أرجع لصفحة البداية بدوس على السهم كذا مرة، والسهم بيرجّعني تاني على صفحة الفنيين
// وعلى صفحة الطلب» — وده مش إزعاج بصري بس: من شاشة فنيين لطلب اتعمل خلاص، اختيار فني تاني
// بيفتح شاشة إنشاء جديدة بمفتاح idempotency جديد ⇒ **طلب تاني حقيقي**.
import 'package:customer_app/features/orders/post_order_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _RouteSpy extends NavigatorObserver {
  final stack = <String>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.add(route.settings.name ?? 'بلا-اسم');
    super.didPush(route, previousRoute);
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.remove(route.settings.name ?? 'بلا-اسم');
    super.didRemove(route, previousRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.remove(route.settings.name ?? 'بلا-اسم');
    super.didPop(route, previousRoute);
  }
}

Widget _screen(String label) => Scaffold(body: Center(child: Text(label)));

void main() {
  testWidgets('بيسيب الرئيسية بس وبيحط الوجهة فوقها — مكدّس الحجز بيختفي', (tester) async {
    final spy = _RouteSpy();
    late BuildContext ctx;

    await tester.pumpWidget(
      MaterialApp(
        navigatorObservers: [spy],
        home: Builder(
          builder: (context) {
            ctx = context;
            return _screen('الرئيسية');
          },
        ),
      ),
    );

    // نبني نفس مكدّس الحجز الحقيقي فوق الرئيسية.
    for (final label in ['الخدمة', 'الموعد', 'الفنيين', 'إنشاء الطلب']) {
      unawaited(
        Navigator.of(ctx).push(
          MaterialPageRoute(
            settings: RouteSettings(name: label),
            builder: (_) => _screen(label),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }
    // '/' هي الشاشة الرئيسية (مسار MaterialApp.home).
    expect(spy.stack, ['/', 'الخدمة', 'الموعد', 'الفنيين', 'إنشاء الطلب']);

    unawaited(replaceBookingStack(ctx, (_) => _screen('تفاصيل الطلب')));
    await tester.pumpAndSettle();

    // كل شاشات الحجز اتشالت، و**الرئيسية فضلت** في القاع — دي النقطة كلها: التطبيق مايخرجش
    // لما العميل يدوس السهم، وفي نفس الوقت مايرجعش لحجز اتعمل خلاص.
    expect(spy.stack.first, '/', reason: 'الرئيسية لازم تفضل في القاع');
    expect(
      spy.stack.where((name) => name != '/' && name != 'بلا-اسم'),
      isEmpty,
      reason: 'مفيش أي شاشة حجز فاضلة في المكدّس',
    );
    expect(find.text('تفاصيل الطلب'), findsOneWidget);

    // والسهم من تفاصيل الطلب بيرجّع للرئيسية مباشرة — مش لشاشة الفنيين.
    Navigator.of(ctx).pop();
    await tester.pumpAndSettle();
    expect(find.text('الرئيسية'), findsOneWidget);
    expect(find.text('الفنيين'), findsNothing);
  });

  testWidgets('من الرئيسية مباشرةً: بيحط الوجهة من غير ما يشيل الرئيسية', (tester) async {
    late BuildContext ctx;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            ctx = context;
            return _screen('الرئيسية');
          },
        ),
      ),
    );

    unawaited(replaceBookingStack(ctx, (_) => _screen('تفاصيل الطلب')));
    await tester.pumpAndSettle();
    expect(find.text('تفاصيل الطلب'), findsOneWidget);

    Navigator.of(ctx).pop();
    await tester.pumpAndSettle();
    expect(find.text('الرئيسية'), findsOneWidget);
  });
}

/// `unawaited` من غير استيراد `dart:async` كامل — الـpush بيرجع Future بيخلص لما الشاشة تتقفل،
/// واستنِاه هنا بيعلّق الاختبار.
void unawaited(Future<void> future) {}
