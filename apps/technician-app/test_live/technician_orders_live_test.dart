// اختبار حي حقيقي — نفس فكرة apps/customer-app/test_live بالظبط (راجع الـ README هناك للتفاصيل
// الكاملة ليه ده ممكن أصلاً من غير emulator/device: test() العادي معندوش قيد الـ HTTP اللي
// TestWidgetsFlutterBinding بيفرضه). بيتأكد من تدفق OTP كامل لحساب فني حقيقي، وإن
// /technician/orders/available شغال (حتى لو رجع قايمة فاضية — المهم إنه معاد 401/500).
// شغّله بـ: flutter test test_live/technician_orders_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';

// مسار اللوج بيتحدد وقت التشغيل (`_live_support.dart`) — كان مكتوب بالإيد لسيشن قديمة فمات معاها.
Future<String> _latestOtpFor(String phoneNumber) => latestOtpFor(phoneNumber);

void main() {
  test('فني حقيقي يسجّل دخول ويجيب طلباته المتاحة (حتى لو فاضية)', () async {
    const phoneNumber = '+201000000021';

    await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
    await Future<void>.delayed(const Duration(milliseconds: 500));
    final otp = await _latestOtpFor(phoneNumber);

    final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
      'phone_number': phoneNumber,
      'otp_code': otp,
    });
    final accessToken = tokens!['access_token'] as String;

    final me = await apiRequest('GET', '/auth/me', accessToken: accessToken);
    expect(me!['phone_number'], phoneNumber);
    expect(me['user_type'], 'technician');

    final available = await apiRequestList('/technician/orders/available', accessToken: accessToken);
    expect(available, isA<List<Map<String, dynamic>>>());
  });
}
