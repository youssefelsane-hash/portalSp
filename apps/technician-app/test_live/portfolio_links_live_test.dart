// اختبار حي حقيقي لمعرض أعمال الفني (لينكات سوشيال ميديا) ضد apps/api الشغال فعلاً.
// شغّله بـ: flutter test test_live/portfolio_links_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_exception.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('[OTP]') && line.contains(phoneNumber));
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
  test('فني يضيف لينك يوتيوب ولينك برابط غلط، يشوفهم في القايمة، وبعدين يحذف واحد', () async {
    final technicianToken = await _loginAs('+201000000011');

    final added = await apiRequest(
      'POST',
      '/technician/portfolio-links',
      accessToken: technicianToken,
      body: {'url': 'https://youtu.be/xyz123abc', 'title': 'اختبار حي'},
    );
    expect(added!['platform'], 'youtube');
    final linkId = added['id'] as String;

    final list = await apiRequestList('/technician/portfolio-links', accessToken: technicianToken);
    expect(list.any((l) => l['id'] == linkId), isTrue);

    // رابط من منصة مش مدعومة لازم يترفض بوضوح.
    ApiException? unsupportedError;
    try {
      await apiRequest(
        'POST',
        '/technician/portfolio-links',
        accessToken: technicianToken,
        body: {'url': 'https://example.com/video'},
      );
    } on ApiException catch (err) {
      unsupportedError = err;
    }
    expect(unsupportedError, isNotNull);
    expect(unsupportedError!.statusCode, 400);

    await apiRequest('DELETE', '/technician/portfolio-links/$linkId', accessToken: technicianToken);
    final listAfterDelete = await apiRequestList('/technician/portfolio-links', accessToken: technicianToken);
    expect(listAfterDelete.any((l) => l['id'] == linkId), isFalse);
  });
}
