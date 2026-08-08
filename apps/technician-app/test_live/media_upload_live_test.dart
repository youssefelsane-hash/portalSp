// اختبار حي حقيقي لرفع صورة قبل/بعد على طلب حقيقي ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/. مفيش camera/emulator حقيقي هنا (documented gap)، فبيستخدم صورة PNG 1×1 حقيقية
// (test_live/fixtures/test-1x1.png) كملف حقيقي بيتبعت فعلاً — كافي لاختبار الـ multipart upload
// وتخزين الملف نفسه (LocalDiskStorageService، راجع orders/README.md)، مش شكل الصورة نفسها.
// شغّله بـ: flutter test test_live/media_upload_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _loginAs(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('فني حقيقي يقبل طلب حقيقي ويرفع صورة قبل/بعد حقيقية عليه', () async {
    final customerToken = await _loginAs('+201000009999');
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
        'problem_description': 'اختبار حي لرفع الصور',
      },
    );
    final orderId = order!['id'] as String;

    final technicianToken = await _loginAs('+201000000011');
    final accepted = await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);
    expect(accepted!['order_status'], 'accepted');

    final imageBytes = await File('test_live/fixtures/test-1x1.png').readAsBytes();

    final beforeMedia = await apiUpload(
      '/technician/orders/$orderId/media',
      fileBytes: imageBytes,
      filename: 'before.png',
      fields: {'media_type': 'before_photo', 'caption': 'اختبار حي قبل الشغل'},
      accessToken: technicianToken,
    );
    expect(beforeMedia, isNotNull);
    expect(beforeMedia!['media_type'], 'before_photo');
    expect(beforeMedia['caption'], 'اختبار حي قبل الشغل');
    expect(beforeMedia['file_url'], isNotEmpty);

    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    final completed =
        await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final afterMedia = await apiUpload(
      '/technician/orders/$orderId/media',
      fileBytes: imageBytes,
      filename: 'after.png',
      fields: {'media_type': 'after_photo'},
      accessToken: technicianToken,
    );
    expect(afterMedia, isNotNull);
    expect(afterMedia!['media_type'], 'after_photo');

    final mediaList = await apiRequestList('/technician/orders/$orderId/media', accessToken: technicianToken);
    expect(mediaList.length, 2);
    expect(mediaList.map((m) => m['media_type']).toSet(), {'before_photo', 'after_photo'});

    // خلّص دورة الطلب — كاش، عشان مفيش طلب معلّق يتراكم من الاختبارات الحية
    await apiRequest('POST', '/technician/orders/$orderId/collect-cash', accessToken: technicianToken);
  });
}
