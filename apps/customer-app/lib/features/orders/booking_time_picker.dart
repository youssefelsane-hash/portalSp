import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../core/arabic_time.dart';
import 'booking_window.dart';

/// **منتقي وقت بداية محصور في نافذة الحجز** (docs/08 §185 بنود 10–11، ADR-0097).
///
/// `showTimePicker` بيعرض الـ٢٤ ساعة كلها: العميل يختار ٣ الفجر، والتطبيق يرفض **بعد**
/// الاختيار بـ«اختار وقت بداية من ٥ ص لـ٧ م». المنتقي ده مابيعرضش أصلًا غير الساعات اللي
/// السيرفر بيقبلها، والأرقام جاية من `GET /settings/booking-window` — لو الأدمن غيّر النافذة
/// لـ٨ → ٤ م، المنتقي بيتغيّر من غير نسخة تطبيق جديدة. مفيش رقم ساعة مكتوب هنا.
///
/// الدقايق **كلها** متاحة (دقة السيرفر بالدقيقة ومااتغيّرتش)، مع احترام الحد الأخير: الساعة
/// الأخيرة ليها `:00` بس (٧:٠٠ م مقبولة، ٧:٠١ م لأ) — نفس `BookingWindow.allows` بالحرف.
///
/// شاشة الموعد وشاشة تأكيد الطلب بيستخدموا **نفس** الدالة — مفيش شاشة فاضلة على
/// `showTimePicker` والتانية على المنتقي ده.
class BookingTimeOptions {
  const BookingTimeOptions(this.window);

  final BookingWindow window;

  /// الساعات اللي ينفع البداية تكون فيها — من أول النافذة لآخرها شاملة.
  List<int> get hours => [
    for (var hour = window.startHour; hour <= window.endHour; hour++) hour,
  ];

  /// الدقايق المتاحة في ساعة معيّنة. الساعة الأخيرة ليها `:00` بس.
  List<int> minutesFor(int hour) =>
      hour >= window.endHour ? const [0] : [for (var m = 0; m < 60; m++) m];

  bool isSelectable(TimeOfDay time) =>
      hours.contains(time.hour) &&
      minutesFor(time.hour).contains(time.minute) &&
      window.allows(time);

  /// أقرب وقت متاح لوقت مقترح: جوّه النافذة يفضل زي ما هو، برّه بيتقصّ على الحدود.
  TimeOfDay clamp(TimeOfDay? time) {
    if (time == null) return window.start;
    final hour = time.hour.clamp(window.startHour, window.endHour);
    final minutes = minutesFor(hour);
    final minute = time.hour > window.endHour
        ? 0
        : time.hour < window.startHour
        ? 0
        : time.minute.clamp(minutes.first, minutes.last);
    return TimeOfDay(hour: hour, minute: minute);
  }
}

/// الساعة بصيغة يومية: «٥ ص»، «١٢ الظهر»، «٧ م».
String bookingHourLabel(int hour) {
  if (hour == 0) return '12 منتصف الليل';
  if (hour == 12) return '12 الظهر';
  final suffix = hour < 12 ? 'ص' : 'م';
  return '${hour <= 12 ? hour : hour - 12} $suffix';
}

/// بيفتح المنتقي ويرجّع وقت **جوّه النافذة** أو `null` لو العميل قفل من غير اختيار.
Future<TimeOfDay?> showBookingTimePicker(
  BuildContext context, {
  required BookingWindow window,
  TimeOfDay? initial,
}) => showModalBottomSheet<TimeOfDay>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (_) => Directionality(
    textDirection: TextDirection.rtl,
    child: BookingTimePickerSheet(window: window, initial: initial),
  ),
);

class BookingTimePickerSheet extends StatefulWidget {
  const BookingTimePickerSheet({super.key, required this.window, this.initial});

  final BookingWindow window;
  final TimeOfDay? initial;

  static const hourWheelKey = ValueKey('booking-time-hour-wheel');
  static const itemExtent = 44.0;

  @override
  State<BookingTimePickerSheet> createState() => _BookingTimePickerSheetState();
}

class _BookingTimePickerSheetState extends State<BookingTimePickerSheet> {
  late final BookingTimeOptions _options = BookingTimeOptions(widget.window);
  late int _hour;
  late int _minute;
  late final FixedExtentScrollController _hourController;
  late FixedExtentScrollController _minuteController;

  @override
  void initState() {
    super.initState();
    final start = _options.clamp(widget.initial);
    _hour = start.hour;
    _minute = start.minute;
    _hourController = FixedExtentScrollController(
      initialItem: _options.hours.indexOf(_hour),
    );
    _minuteController = FixedExtentScrollController(
      initialItem: _options.minutesFor(_hour).indexOf(_minute),
    );
  }

  @override
  void dispose() {
    _hourController.dispose();
    _minuteController.dispose();
    super.dispose();
  }

  void _onHourChanged(int index) {
    final hour = _options.hours[index];
    final minutes = _options.minutesFor(hour);
    final minute = minutes.contains(_minute) ? _minute : minutes.first;
    final rebuildMinutes = minutes.length != _options.minutesFor(_hour).length;
    setState(() {
      _hour = hour;
      _minute = minute;
      if (rebuildMinutes) {
        // عدد الدقايق اتغيّر (دخلنا/خرجنا من الساعة الأخيرة) — عجلة جديدة على الدقيقة الصح.
        _minuteController.dispose();
        _minuteController = FixedExtentScrollController(
          initialItem: minutes.indexOf(minute),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final minutes = _options.minutesFor(_hour);
    final selected = TimeOfDay(hour: _hour, minute: _minute);

    Widget wheel({
      required Key key,
      required FixedExtentScrollController controller,
      required List<String> labels,
      required ValueChanged<int> onChanged,
    }) => Expanded(
      child: CupertinoPicker(
        key: key,
        scrollController: controller,
        itemExtent: BookingTimePickerSheet.itemExtent,
        onSelectedItemChanged: onChanged,
        selectionOverlay: CupertinoPickerDefaultSelectionOverlay(
          background: theme.colorScheme.primary.withValues(alpha: 0.10),
        ),
        children: [
          for (final label in labels)
            Center(
              child: Text(
                label,
                style: theme.textTheme.titleMedium,
                textDirection: TextDirection.rtl,
              ),
            ),
        ],
      ),
    );

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('اختار وقت بداية الشغل', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              widget.window.helperAr,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: BookingTimePickerSheet.itemExtent * 5,
              // الساعة على اليمين والدقيقة على الشمال — نفس ترتيب القراية «٥:٣٠».
              child: Row(
                children: [
                  wheel(
                    key: BookingTimePickerSheet.hourWheelKey,
                    controller: _hourController,
                    labels: _options.hours.map(bookingHourLabel).toList(),
                    onChanged: _onHourChanged,
                  ),
                  Text(':', style: theme.textTheme.titleLarge),
                  wheel(
                    // مفتاح بعدد الدقايق: العجلة بتتبني من جديد لما الساعة الأخيرة تتختار.
                    key: ValueKey('booking-time-minute-wheel-${minutes.length}'),
                    controller: _minuteController,
                    labels: minutes.map((m) => m.toString().padLeft(2, '0')).toList(),
                    onChanged: (index) => setState(() => _minute = minutes[index]),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _options.isSelectable(selected)
                  ? () => Navigator.of(context).pop(selected)
                  : null,
              child: Text('تأكيد الساعة ${formatArabicTime(selected)}'),
            ),
          ],
        ),
      ),
    );
  }
}
