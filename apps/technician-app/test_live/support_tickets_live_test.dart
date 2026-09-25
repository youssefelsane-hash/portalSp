// **حارس للفجوة اللي اتقفلت**: الباك-إند بيدي الفني نفس حقوق العميل في تذاكر الدعم من زمان
// (`@Roles(CUSTOMER, TECHNICIAN)` على `support-tickets`)، وتطبيق الفني مكانش فيه **أي** واجهة
// ليها — الموجود كان الشكاوى بس، وهي حاجة تانية (شكوى على **طلب بعينه**).
//
// الاختبار بيمشي على نفس المسارات اللي `SupportRepository` في التطبيق بينادها بالظبط.
// شغّله بـ:
//   flutter test test_live/support_tickets_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';

void main() {
  test('فني حقيقي يفتح تذكرة دعم، يلاقيها في تذاكره، ويقيّم الدعم', () async {
    final accessToken = await devTechnicianToken('+201000000041');
    final subject = 'مشكلة في أرباحي — اختبار حي ${DateTime.now().millisecondsSinceEpoch}';

    final created = await apiRequest(
      'POST',
      '/support-tickets',
      accessToken: accessToken,
      body: {'subject': subject, 'category': 'payment', 'channel': 'app'},
    );
    expect(created, isNotNull);
    final ticketId = created!['id'] as String;
    expect(created['ticket_number'], isNotNull);
    expect(created['ticket_status'], 'open');

    // بتظهر في «تذاكري» — نفس النداء اللي الشاشة بتعمله.
    final mine = await apiRequestList('/support-tickets', accessToken: accessToken);
    expect(mine.any((t) => t['id'] == ticketId), isTrue,
        reason: 'التذكرة المفتوحة لازم تبان في قايمة تذاكر الفني');

    // التذكرة الواحدة بتتقري بمعرّفها.
    final one = await apiRequest('GET', '/support-tickets/$ticketId', accessToken: accessToken);
    expect(one!['subject'], subject);

    // التقييم: لازم التذكرة تبقى اتقفلت الأول — تقييم تذكرة مفتوحة مالوش معنى، والسيرفر بيرفضه.
    Object? tooEarly;
    try {
      await apiRequest('POST', '/support-tickets/$ticketId/satisfaction',
          accessToken: accessToken, body: {'satisfaction_rating': 5});
    } catch (e) {
      tooEarly = e;
    }
    expect(tooEarly, isNotNull,
        reason: 'تقييم تذكرة لسه مفتوحة المفروض يترفض');
  });
}
