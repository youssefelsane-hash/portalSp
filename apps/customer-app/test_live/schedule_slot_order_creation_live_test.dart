// اختبار حي حقيقي لربط الجدولة الحقيقية للفني (docs/08 §2-§3) بمسار إنشاء الطلب — كانت
// TechnicianScheduleService.bookSlot() جاهزة ومختبرة في الباك-إند بلا أي caller خالص. مختلف عن
// باقي test_live بإنه بيسجّل فني/عميل حقيقيين ويبني سلوت بنفسه (نفس فلسفة
// pricing_engine_order_creation_live_test.dart — استقرار عبر السيشنز المختلفة).
// شغّله بـ: flutter test test_live/schedule_slot_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber, File log) async {
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _loginAs(String phoneNumber, File log) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber, log);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('عميل حقيقي يحجز سلوت فاضي من جدول فني بعينه، ويترفض سباق نفس السلوت من عميل تاني', () async {
    // عدّل مسار اللوج ده لملف log السيرفر الفعلي بتاع السيشن اللي بتشغّل الاختبار فيها
    // (نفس القيد الموجود في order_creation_live_test.dart).
    final serverLog = File(Platform.environment['API_SERVER_LOG'] ?? '/tmp/server.log');

    // فني حقيقي عنده تسجيل دخول مسبق في بيانات الاختبار الحية (نفس المستخدم اللي باقي
    // test_live الأخرى بتستخدمه) — لازم يكون مؤهّل لخدمة حقيقية عشان المطابقة تنجح.
    const technicianPhone = '+201000000102';
    final technicianToken = await _loginAs(technicianPhone, serverLog);
    final customerAToken = await _loginAs('+201000005501', serverLog);
    final customerBToken = await _loginAs('+201000000101', serverLog);

    final me = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    // مش محتاجين نتيجته فعليًا، بس بيتأكد التوكن شغال — لو فشل، هيرمي ApiException واضح.
    expect(me, anyOf(isNull, isA<Map<String, dynamic>>()));

    final slotDate = DateTime.now().add(const Duration(days: 2)).toIso8601String().substring(0, 10);
    final slot = await apiRequest('POST', '/technician/schedule', accessToken: technicianToken, body: {
      'slot_date': slotDate,
      'start_time': '09:00:00',
      'end_time': '11:00:00',
      'notes_ar': 'اختبار Dart حي لربط الجدولة',
    });
    final slotId = slot!['id'] as String;

    // الجدول العام بمنظور العميل — نفس endpoint اللي TechnicianProfileScreen بيستخدمه.
    final technicianProfileId = slot['technician_id'] as String;
    final publicSchedule = await apiRequestList('/technicians/$technicianProfileId/schedule', accessToken: customerAToken);
    expect(publicSchedule.any((s) => s['id'] == slotId && s['is_available'] == true), isTrue);

    // نفس الخدمة اللي الفني ده مؤهّل ليها فعليًا (technician_services) — أي خدمة تانية هتخلّي
    // matching يرفض الفني ده أصلاً حتى لو السلوت اتحجز صح، فمش هيثبت الربط المطلوب اختباره.
    final technicianProfile = await apiRequest('GET', '/technicians/$technicianProfileId/profile', accessToken: customerAToken);
    final technicianServices = (technicianProfile!['services'] as List<dynamic>).cast<Map<String, dynamic>>();
    expect(technicianServices, isNotEmpty, reason: 'محتاجين الفني يكون مؤهّل لخدمة حقيقية واحدة على الأقل');
    final serviceId = technicianServices.first['id'] as String;

    final cities = await apiRequestList('/cities');
    final areas = await apiRequestList('/cities/${cities.first['id']}/areas');
    final address = await apiRequest('POST', '/addresses', accessToken: customerAToken, body: {
      'city_id': cities.first['id'],
      'area_id': areas.first['id'],
      'street_name': 'شارع اختبار الجدولة',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'اختبار Dart حي — جدولة',
    });
    final addressId = address!['id'] as String;

    // العميل التاني بيحاول يحجز نفس السلوت في نفس اللحظة تقريبًا — لازم يترفض بوضوح
    // (bookSlot() الذرّي جوّه transaction إنشاء الطلب)، مش يعدّي بصمت على سلوت اتحجز بالفعل.
    Map<String, dynamic>? orderA;
    Map<String, dynamic>? orderB;
    Object? errorA;
    Object? errorB;

    await Future.wait([
      apiRequest('POST', '/orders', accessToken: customerAToken, body: {
        'service_id': serviceId,
        'address_id': addressId,
        'schedule_slot_id': slotId,
      }).then((v) => orderA = v).catchError((Object err) {
        errorA = err;
        return null;
      }),
      apiRequest('POST', '/orders', accessToken: customerBToken, body: {
        'service_id': serviceId,
        'address_id': addressId,
        'schedule_slot_id': slotId,
      }).then((v) => orderB = v).catchError((Object err) {
        errorB = err;
        return null;
      }),
    ]);

    final succeeded = [orderA, orderB].where((o) => o != null).toList();
    expect(succeeded, hasLength(1), reason: 'سلوت واحد لازم يتحجز مرة واحدة بس — مش الاتنين ولا صفر');
    expect([errorA, errorB].where((e) => e != null), hasLength(1), reason: 'الطرف اللي متأخر لازم يترفض بخطأ واضح');

    final createdOrder = succeeded.first!;
    expect(createdOrder['scheduled_at'], isNotNull);
    final orderId = createdOrder['id'] as String;
    final winnerToken = orderA != null ? customerAToken : customerBToken;

    // تنظيف — الإلغاء بيحرر السلوت تاني (ScheduleSlotReleaseListener)
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: winnerToken, body: {'reason': 'تنظيف اختبار حي'});
    final freedSchedule = await apiRequestList('/technicians/$technicianProfileId/schedule', accessToken: customerAToken);
    expect(freedSchedule.firstWhere((s) => s['id'] == slotId)['is_available'], isTrue);

    await apiRequest('DELETE', '/technician/schedule/$slotId', accessToken: technicianToken);
    await apiRequest('DELETE', '/addresses/$addressId', accessToken: customerAToken);
  });
}
