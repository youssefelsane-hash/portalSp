// docs/08 §185 بنود 10–11 و30 — منتقي وقت البداية المحصور في نافذة الحجز. الحالات هي اللي
// المالك كتبها بالحرف: 5→19 مايعرضش 04 ولا 20، 05:00 و18:59 و19:00 متاحين، 19:01 لأ،
// ونافذة 8→16 من السيرفر بتغيّر المنتقي من غير أي رقم مكتوب في الكود.
import 'package:customer_app/features/orders/booking_time_picker.dart';
import 'package:customer_app/features/orders/booking_window.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final _serverWindow = BookingWindow.fromJson({'start_hour': 5, 'end_hour': 19});

Future<Future<TimeOfDay?>> _open(
  WidgetTester tester,
  BookingWindow window, {
  TimeOfDay? initial,
}) async {
  tester.view.physicalSize = const Size(360, 780);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  late Future<TimeOfDay?> result;
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => result = showBookingTimePicker(
                context,
                window: window,
                initial: initial,
              ),
              child: const Text('افتح'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('افتح'));
  await tester.pumpAndSettle();
  return Future.value(result);
}

Future<void> _scrollWheel(WidgetTester tester, Finder wheel, int items) async {
  await tester.drag(
    wheel,
    Offset(0, -BookingTimePickerSheet.itemExtent * items),
    touchSlopY: 0,
  );
  await tester.pumpAndSettle();
}

void main() {
  group('BookingTimeOptions — النافذة من السيرفر (5 → 19)', () {
    final options = BookingTimeOptions(_serverWindow);

    test('الساعات من 5 لـ19 بس: مفيش 04 ولا 20', () {
      expect(options.hours.first, 5);
      expect(options.hours.last, 19);
      expect(options.hours, isNot(contains(4)));
      expect(options.hours, isNot(contains(20)));
      expect(options.hours, isNot(contains(0)));
    });

    test('05:00 و12:30 و18:59 و19:00 متاحين — 04:59 و19:01 و20:00 لأ', () {
      for (final ok in const [
        TimeOfDay(hour: 5, minute: 0),
        TimeOfDay(hour: 5, minute: 15),
        TimeOfDay(hour: 12, minute: 30),
        TimeOfDay(hour: 18, minute: 59),
        TimeOfDay(hour: 19, minute: 0),
      ]) {
        expect(options.isSelectable(ok), isTrue, reason: '$ok');
      }
      for (final no in const [
        TimeOfDay(hour: 4, minute: 59),
        TimeOfDay(hour: 19, minute: 1),
        TimeOfDay(hour: 20, minute: 0),
      ]) {
        expect(options.isSelectable(no), isFalse, reason: '$no');
      }
    });

    test('الساعة الأخيرة ليها :00 بس، وباقي الساعات كل الدقايق', () {
      expect(options.minutesFor(19), [0]);
      expect(options.minutesFor(18), hasLength(60));
      expect(options.minutesFor(18).last, 59);
    });

    test('وقت مقترح برّه النافذة بيتقص على أقرب حد', () {
      expect(options.clamp(const TimeOfDay(hour: 3, minute: 40)), const TimeOfDay(hour: 5, minute: 0));
      expect(options.clamp(const TimeOfDay(hour: 19, minute: 1)), const TimeOfDay(hour: 19, minute: 0));
      expect(options.clamp(const TimeOfDay(hour: 22, minute: 10)), const TimeOfDay(hour: 19, minute: 0));
      expect(options.clamp(null), const TimeOfDay(hour: 5, minute: 0));
    });
  });

  testWidgets('المنتقي بيبدأ من أول النافذة، وتأكيده بيرجّع 05:00', (tester) async {
    final result = await _open(tester, _serverWindow);
    expect(find.text('5 ص'), findsOneWidget);
    expect(find.text('4 ص'), findsNothing);
    await tester.tap(find.textContaining('تأكيد الساعة'));
    await tester.pumpAndSettle();
    expect(await result, const TimeOfDay(hour: 5, minute: 0));
  });

  testWidgets('18:59 بالعجلات', (tester) async {
    final result = await _open(tester, _serverWindow, initial: const TimeOfDay(hour: 18, minute: 0));
    await _scrollWheel(tester, find.byType(CupertinoPicker).last, 59);
    await tester.tap(find.textContaining('تأكيد الساعة'));
    await tester.pumpAndSettle();
    expect(await result, const TimeOfDay(hour: 18, minute: 59));
  });

  testWidgets('اختيار الساعة الأخيرة بيقصّ الدقايق لـ:00 — 19:01 مش ممكن أصلًا', (tester) async {
    final result = await _open(tester, _serverWindow, initial: const TimeOfDay(hour: 18, minute: 30));
    await _scrollWheel(tester, find.byKey(BookingTimePickerSheet.hourWheelKey), 1);
    // عجلة الدقايق بقت عنصر واحد بس.
    final minuteWheel = tester.widget<CupertinoPicker>(find.byType(CupertinoPicker).last);
    expect(minuteWheel.childDelegate.estimatedChildCount, 1);
    await tester.tap(find.textContaining('تأكيد الساعة'));
    await tester.pumpAndSettle();
    expect(await result, const TimeOfDay(hour: 19, minute: 0));
  });

  testWidgets('الأدمن غيّر النافذة لـ8 → 16: المنتقي اتغيّر من غير أي build جديد', (tester) async {
    final adminWindow = BookingWindow.fromJson({'start_hour': 8, 'end_hour': 16});
    final options = BookingTimeOptions(adminWindow);
    expect(options.hours, [8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(options.isSelectable(const TimeOfDay(hour: 7, minute: 59)), isFalse);
    expect(options.isSelectable(const TimeOfDay(hour: 16, minute: 1)), isFalse);

    // وقت مقترح قديم (5 الصبح) من النافذة القديمة بيتقصّ على البداية الجديدة.
    final result = await _open(tester, adminWindow, initial: const TimeOfDay(hour: 5, minute: 0));
    expect(find.text('8 ص'), findsOneWidget);
    expect(find.text('5 ص'), findsNothing);
    expect(find.textContaining('من 8 ص لـ4 م'), findsOneWidget);
    await _scrollWheel(tester, find.byKey(BookingTimePickerSheet.hourWheelKey), 20);
    await tester.tap(find.textContaining('تأكيد الساعة'));
    await tester.pumpAndSettle();
    expect(await result, const TimeOfDay(hour: 16, minute: 0));
  });
}
