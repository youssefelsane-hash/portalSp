// اختبار حي حقيقي لشكاوى العميل (docs/08 §19 بند 13) ضد apps/api الشغال فعلاً — نفس أسلوب
// pending_payment_order_creation_live_test.dart بالحرف لتسجيل عميل جديد + إنشاء طلب حقيقي. بيثبت
// إن SupportRepository الجديدة (file/listMine/getOne/listMessages/addMessage/listAttachments/
// uploadAttachment) بتتفاهم صح مع الباك-إند الحقيقي (support.controller.ts، مختبر أصلاً من جانب
// الباك-إند نفسه) — هنا بنتأكد إن الـwire format اللي customer-app بيبعته/بيقراه مفهوم صح.
// شغّله بـ: flutter test test_live/complaints_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/33b6554f-4f97-567b-a9a1-7de4b0f6b43a/scratchpad/api-server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

Future<String> _registerAndLogin() async {
  final suffix = (DateTime.now().millisecondsSinceEpoch % 100000000).toString().padLeft(8, '0');
  final phoneNumber = '+2010$suffix';
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'register'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final registerOtp = await _latestOtpFor(phoneNumber);
  await apiRequest('POST', '/auth/register', body: {
    'phone_number': phoneNumber,
    'otp_code': registerOtp,
    'full_name': 'عميل اختبار حي شكاوى',
    'user_type': 'customer',
  });

  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final loginOtp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': loginOtp,
  });
  return tokens!['access_token'] as String;
}

// PNG حقيقي (1×1 بكسل شفاف) — لازم بايتات صحيحة فعليًا، مش عشوائية: assertFileSignatureMatches
// (docs/08 §19 بند 10) بقى بيتحقق من magic bytes الحقيقية على نفس الـendpoint ده بالظبط.
final _tinyValidPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

void main() {
  test('عميل حقيقي بيفتح شكوى مربوطة بطلب، يبعت رسالة، ويرفع مرفق', () async {
    final accessToken = await _registerAndLogin();

    final cities = await apiRequestList('/cities');
    expect(cities, isNotEmpty);
    final cityId = cities.first['id'] as String;
    final areas = await apiRequestList('/cities/$cityId/areas');
    expect(areas, isNotEmpty);
    final areaId = areas.first['id'] as String;

    final address = await apiRequest('POST', '/addresses', accessToken: accessToken, body: {
      'city_id': cityId,
      'area_id': areaId,
      'street_name': 'شارع اختبار شكاوى',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'اختبار flutter live — شكاوى',
    });
    final addressId = address!['id'] as String;

    final categories = await apiRequestList('/service-categories');
    String? serviceId;
    for (final category in categories) {
      final services = await apiRequestList('/services?category_id=${category['id']}');
      if (services.isNotEmpty) {
        serviceId = services.first['id'] as String;
        break;
      }
    }
    expect(serviceId, isNotNull, reason: 'محتاجين خدمة واحدة على الأقل عشان نربط الشكوى بطلب حقيقي');

    final order = await apiRequest('POST', '/orders', accessToken: accessToken, body: {
      'service_id': serviceId!,
      'address_id': addressId,
      'problem_description': 'اختبار حي — شكوى',
    });
    final orderId = order!['id'] as String;

    // (أ) فتح الشكوى — نفس الـbody اللي SupportRepository.file() بيبعته.
    final complaint = await apiRequest('POST', '/complaints', accessToken: accessToken, body: {
      'order_id': orderId,
      'category': 'poor_quality',
      'title': 'الشغل مكنش نضيف',
      'description': 'الفني سابلي المكان مش نضيف بعد ما خلص الشغل، محتاج حد يشوفها.',
    });
    expect(complaint, isNotNull);
    expect(complaint!['order_id'], orderId);
    expect(complaint['category'], 'poor_quality');
    expect(complaint['complaint_status'], 'open');
    final complaintId = complaint['id'] as String;

    // (ب) القايمة والتفاصيل — نفس اللي ComplaintsScreen/ComplaintDetailScreen بيقروهم.
    final mine = await apiRequestList('/complaints', accessToken: accessToken);
    expect(mine.any((c) => c['id'] == complaintId), isTrue);

    final fetched = await apiRequest('GET', '/complaints/$complaintId', accessToken: accessToken);
    expect(fetched!['id'], complaintId);

    // (ج) رسالة — نفس SupportRepository.addMessage().
    final message = await apiRequest(
      'POST',
      '/complaints/$complaintId/messages',
      accessToken: accessToken,
      body: {'message': 'في تحديث؟'},
    );
    expect(message, isNotNull);
    expect(message!['sender_role'], 'customer');
    expect(message['message'], 'في تحديث؟');

    final messages = await apiRequestList('/complaints/$complaintId/messages', accessToken: accessToken);
    expect(messages, hasLength(1));

    // (د) مرفق — نفس SupportRepository.uploadAttachment()، وبيثبت إن اتصال بند 10
    // (assertFileSignatureMatches) مش بيكسر مسار رفع شرعي على الـendpoint ده.
    final attachment = await apiUpload(
      '/complaints/$complaintId/attachments',
      fileBytes: _tinyValidPng,
      filename: 'evidence.png',
      accessToken: accessToken,
    );
    expect(attachment, isNotNull);
    expect(attachment!['file_url'], isNotEmpty);

    final attachments = await apiRequestList('/complaints/$complaintId/attachments', accessToken: accessToken);
    expect(attachments, hasLength(1));

    await apiRequest('DELETE', '/addresses/$addressId', accessToken: accessToken);
  });
}
