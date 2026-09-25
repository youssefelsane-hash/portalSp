// اختبار حي حقيقي — نفس فكرة apps/customer-app/test_live بالظبط (راجع الـ README هناك للتفاصيل
// الكاملة ليه ده ممكن أصلاً من غير emulator/device: test() العادي معندوش قيد الـ HTTP اللي
// TestWidgetsFlutterBinding بيفرضه). بيتأكد من تدفق **رمز الدخول** كامل لحساب فني حقيقي
// (ADR-0109)، وإن /technician/orders/available شغال (حتى لو رجع قايمة فاضية — المهم إنه
// معاد 401/500).
// شغّله بـ: flutter test test_live/technician_orders_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';

void main() {
  test('فني حقيقي يسجّل دخول برمزه ويجيب طلباته المتاحة (حتى لو فاضية)', () async {
    // رقم فني مُجهّز من `scripts/seed-dev-accounts.js` — والسكربت ده هو اللي بيحط له الرمز.
    const phoneNumber = '+201000000021';

    // **الفرق الجوهري (ADR-0109)**: نداء واحد. مفيش لوج بيتقرا، ومفيش انتظار ٥٠٠ مللي على
    // أمل إن السطر يكون اتكتب.
    final accessToken = await loginWithPin(phoneNumber);

    final me = await apiRequest('GET', '/auth/me', accessToken: accessToken);
    expect(me!['phone_number'], phoneNumber);
    expect(me['user_type'], 'technician');

    final available = await apiRequestList('/technician/orders/available', accessToken: accessToken);
    expect(available, isA<List<Map<String, dynamic>>>());
  });
}
