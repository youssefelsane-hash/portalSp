import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/arabic_time.dart';

/// **الوقت جوّه جملة عربية** (بلاغ مالك 2026-09-16، docs/08 §152).
///
/// البلاغ: «الكلام اللي مكتوب لما حد بيترشح، الكلام عربي على إنجليزي على أرقام… شكله مش نظيف».
///
/// السبب كان `TimeOfDay.format(context)` — بترجّع `11:55 AM`، والحروف اللاتينية «قوية LTR»
/// فبتقلب ترتيب الجملة العربية حواليها على الشاشة.
void main() {
  group('formatArabicTime — بلا حروف لاتينية ومعزول اتجاهيًا', () {
    test('الصبح بيطلع «ص» مش «AM»', () {
      final formatted = formatArabicTime(const TimeOfDay(hour: 11, minute: 55));
      expect(formatted, contains('11:55'));
      expect(formatted, contains('ص'));
      // **جوهر البَقّة**: أي حرف لاتيني في المقطع ده بيقلب الجملة.
      expect(RegExp(r'[A-Za-z]').hasMatch(formatted), isFalse);
    });

    test('بعد الضهر بيطلع «م»، والساعة بتتحوّل لـ١٢ ساعة', () {
      expect(formatArabicTime(const TimeOfDay(hour: 19, minute: 30)), contains('7:30 م'));
      expect(formatArabicTime(const TimeOfDay(hour: 13, minute: 5)), contains('1:05 م'));
    });

    test('منتصف الليل والظهر بيطلعوا ١٢ مش ٠', () {
      expect(formatArabicTime(const TimeOfDay(hour: 0, minute: 5)), contains('12:05 ص'));
      expect(formatArabicTime(const TimeOfDay(hour: 12, minute: 0)), contains('12:00 م'));
    });

    test('الدقايق دايمًا خانتين — «9:5 م» غلط مطبعي واضح', () {
      expect(formatArabicTime(const TimeOfDay(hour: 21, minute: 5)), contains('9:05 م'));
    });

    test('المقطع مغلّف بمحارف عزل اتجاهي — ده اللي بيمنع سحب الترقيم المجاور', () {
      final formatted = formatArabicTime(const TimeOfDay(hour: 11, minute: 55));
      expect(formatted.codeUnitAt(0), 0x2068, reason: 'لازم يبدأ بـFSI');
      expect(formatted.codeUnitAt(formatted.length - 1), 0x2069, reason: 'لازم ينتهي بـPDI');
    });

    test('formatArabicTimeOfDay بتحوّل للتوقيت المحلي الأول', () {
      final local = DateTime(2027, 6, 10, 14, 20);
      expect(formatArabicTimeOfDay(local.toUtc()), contains('2:20 م'));
    });
  });

  /// الجملة كاملة زي ما العميل بيشوفها — الاختبار ده هو اللي كان بيفشل قبل الإصلاح.
  test('جملة حجز السعر مفيهاش أي حرف لاتيني', () {
    final sentence =
        'السعر ده محجوز لك مع الأسطى ده لحد '
        '${formatArabicTime(const TimeOfDay(hour: 11, minute: 55))} — '
        'ولو غيّرت أي تفصيلة هنرشّح لك من جديد.';
    expect(RegExp(r'[A-Za-z]').hasMatch(sentence), isFalse);
    // والنقطة اللي كانت لازقة في الوقت (ومسحوبة معاه في الـbidi) بقت شرطة محايدة.
    expect(sentence.contains('م. '), isFalse);
  });
}
