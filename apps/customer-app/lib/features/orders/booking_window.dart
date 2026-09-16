import 'package:flutter/material.dart';

import '../../core/api_client.dart';

/// **نافذة اختيار الموعد** (طلب مالك 2026-09-15، docs/08 §151، ADR-0097).
///
/// > «مواعيد الشغل عندنا الـcustomer ينفع يختارها بتكون من الساعة ٥ صباحًا إلى الساعة ٧ مساءً…
/// >  الشغل عادي بقى في أي وقت، والـschedule عادي بيتحسب زي ما هو… ولكن هو **الاختيار نفسه**
/// >  مش مسموح له يختار حاجة برا الحدود دي.»
///
/// القيد على **لحظة البداية** بس: شغلانة بتبدأ ٦ م وبتاخد ٤ ساعات بتخلص ١٠ م عادي.
///
/// الأرقام **بتيجي من السيرفر** (`GET /booking-slots/days` بيرجّع `booking_window`) — كتابة ٥
/// و١٩ في كود التطبيق كانت هتخلّي تغيير الإعداد من لوحة الأدمن يحتاج نشر تطبيق جديد، وأسوأ:
/// التطبيق يسمح بوقت السيرفر بيرفضه فالعميل ياخد خطأ بعد ما يكمّل كل الخطوات.
class BookingWindow {
  final int startHour;
  final int endHour;

  const BookingWindow({required this.startHour, required this.endHour});

  /// الافتراضي مطابق لـ`DEFAULT_BOOKING_WINDOW` في الباك-إند — بيُستخدم بس لو النداء فشل،
  /// فالشاشة تفضل شغّالة بدل ما تتقفل.
  static const BookingWindow fallback = BookingWindow(startHour: 5, endHour: 19);

  factory BookingWindow.fromJson(Map<String, dynamic>? json) {
    if (json == null) return fallback;
    final start = (json['start_hour'] as num?)?.toInt();
    final end = (json['end_hour'] as num?)?.toInt();
    if (start == null || end == null || start > end) return fallback;
    return BookingWindow(startHour: start.clamp(0, 23), endHour: end.clamp(0, 23));
  }

  TimeOfDay get start => TimeOfDay(hour: startHour, minute: 0);
  TimeOfDay get end => TimeOfDay(hour: endHour, minute: 0);

  /// نفس قاعدة الباك-إند بالحرف: الساعة الأخيرة **شاملة** عند الدقيقة صفر — ٧:٠٠ م مقبولة
  /// و٧:٣٠ م لأ.
  bool allows(TimeOfDay time) {
    final minutes = time.hour * 60 + time.minute;
    return minutes >= startHour * 60 && minutes <= endHour * 60;
  }

  String get labelAr => 'من ${_hourAr(startHour)} لـ${_hourAr(endHour)}';

  String get helperAr =>
      'مواعيد بدء الشغل $labelAr. الشغل نفسه ممكن يكمّل بعدها عادي.';

  String get rejectionAr =>
      'اختار وقت بداية $labelAr — الشغل نفسه ممكن يكمّل بعد كده عادي.';

  /// `GET /settings/booking-window` — **عام** (بلا توكن) وبيتكاش لعمر العملية، لأن الرقمين
  /// بيتغيّروا نادرًا جدًا والشاشتين بيسألوا عنهم في نفس الرحلة.
  ///
  /// أي فشل بيرجّع الافتراضي بهدوء: قفل شاشة الحجز عشان نداء إعدادات وقع مقايضة غلط — السيرفر
  /// هو الحارس الحقيقي على أي حال.
  static Future<Map<String, dynamic>?>? _inFlight;

  static Future<BookingWindow> fetch() async {
    try {
      final data = await (_inFlight ??= apiRequest('GET', '/settings/booking-window')
          .catchError((Object err) {
            _inFlight = null;
            throw err;
          }));
      return BookingWindow.fromJson(data);
    } catch (_) {
      return fallback;
    }
  }

  /// للاختبارات فقط — بتصفّر الكاش عشان كل حالة تبدأ من نقطة معروفة.
  static void resetCacheForTests() => _inFlight = null;

  static String _hourAr(int hour) {
    if (hour == 0) return '١٢ منتصف الليل';
    if (hour == 12) return '١٢ الظهر';
    final suffix = hour < 12 ? 'ص' : 'م';
    final display = hour <= 12 ? hour : hour - 12;
    return '$display $suffix';
  }
}
