import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'api_config.dart';

/// تتبّع رحلة الحجز من التطبيق (ADR-0081 §3، إحصائيات-٦).
///
/// ## المشكلة اللي الملف ده بيحلّها
///
/// السيرفر بيسجّل المراحل اللي ليها نداء حقيقي (السعر، الفنيين، تأكيد الطلب). بس «فتح شاشة
/// الخدمة» و«ضغط احجز» بيحصلوا **جوّه التطبيق من غير أي نداء**، فمن غير التسجيل ده أول رقم في
/// الفنل بيبقى «شاف السعر» — والسؤال «كام حد فتح الشاشة وما كمّلش؟» يفضل بلا إجابة.
///
/// ## معرّف المحاولة
///
/// UUID واحد لكل **تشغيلة تطبيق**، عايش في الذاكرة بس — **مش مخزّن على الجهاز عن قصد**. لو
/// اتخزّن، كل حجوزات المستخدم على مدى شهور كانت هتبقى «محاولة واحدة» والتسرّب بين المراحل
/// يتحسب غلط. ومالوش أي علاقة بهوية المستخدم: ده مش معرّف تتبّع للشخص.
class FunnelTracker {
  FunnelTracker._();

  static final FunnelTracker instance = FunnelTracker._();

  static const _headerName = 'x-funnel-session';
  final String _sessionId = _randomUuidV4();

  /// الهيدر اللي بيربط أي نداء API بمحاولة الحجز — بيتحط في `api_client` على كل نداء.
  Map<String, String> get headers => {_headerName: _sessionId};

  /// تسجيل مرحلة من الكلاينت.
  ///
  /// **مابيرميش أبدًا ومابيتستنّاش**: الشاشة ماينفعش تتأخر ولا تقع عشان رقم في تقرير. أسوأ
  /// نتيجة ممكنة هنا حدث ضايع. نفس القاعدة اللي `FunnelTrackerService` في الباك-إند ماشي بيها.
  void track(String stage, {String? serviceId, String? cityId}) {
    // المراحل المسموحة من الكلاينت بس — الباقي بيتسجّل سيرفر-سايد (السيرفر بيرفضها بـ400).
    if (stage != 'service_viewed' && stage != 'booking_started') return;

    _post(stage, serviceId, cityId);
  }

  void _post(String stage, String? serviceId, String? cityId) {
    http
        .post(
          Uri.parse('$apiBaseUrl/analytics/funnel-events'),
          headers: {'Content-Type': 'application/json', ...headers},
          body: jsonEncode({
            'stage': stage,
            'channel': 'customer_app',
            'service_id': ?serviceId,
            'city_id': ?cityId,
          }),
        )
        // متعمّد: الفشل (نت مقطوع، سيرفر واقع، throttle) مالوش أي أثر على المستخدم.
        .catchError((_) => http.Response('', 204));
  }
}

/// UUIDv4 من `Random.secure()` — الحزمة `uuid` مش من ضمن اعتماديات التطبيق، وإضافة حزمة كاملة
/// عشان سطرين مش مبرَّرة.
String _randomUuidV4() {
  final rnd = Random.secure();
  final bytes = List<int>.generate(16, (_) => rnd.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // النسخة 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // المتغيّر
  String hex(int start, int end) =>
      bytes.sublist(start, end).map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}
