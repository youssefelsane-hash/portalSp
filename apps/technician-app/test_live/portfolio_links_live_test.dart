// اختبار حي حقيقي لمعرض أعمال الفني (لينكات سوشيال ميديا) ضد apps/api الشغال فعلاً.
// شغّله بـ: flutter test test_live/portfolio_links_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_exception.dart';
import '_live_support.dart';


void main() {
  test('فني يضيف لينك يوتيوب ولينك برابط غلط، يشوفهم في القايمة، وبعدين يحذف واحد', () async {
    final technicianToken = await devTechnicianToken('+201000000047');

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
