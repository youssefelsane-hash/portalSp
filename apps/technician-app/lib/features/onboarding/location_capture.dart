import 'package:geolocator/geolocator.dart';
import 'onboarding_repository.dart';

// بلاغ مالك صريح (docs/08 §73 بند 4): "لو مش فاتح GPS دلوقتي، مش هييجيلي طلبات — المفروض
// يوصل على آخر موقع معروف". السيرفر أصلاً بيعمل كده بالظبط (`current_location IS NOT NULL`،
// صفر شرط حداثة/staleness — راجع matching.service.ts). الجذر الحقيقي: current_location كان
// بيتسجّل مرة واحدة بس، لما AvailableOrdersScreen تفتح (initState → 3 محاولات). لو المحاولة
// الوحيدة دي فشلت (سباق إذن، GPS مقفول وقتها بالظبط، أو حساب اتعمله الأدمن ومحدش فتح الشاشة
// دي أصلاً) — العمود يفضل NULL للأبد، وده اللي بيحس الفني بيه كـ"لو مش فاتح GPS دلوقتي مش
// هييجيلي طلبات".
//
// الدالة دي **صامتة بالكامل عمدًا** (بلا SnackBar/feedback) — نسخة مبسّطة من
// AvailableOrdersScreen._captureLocationOnce() (اللي فضلت زي ما هي، ليها feedback رسائل مفصّلة
// للزرار اليدوي "فعّل الموقع الآن" ومحتاجة تفضل كده). استُخدمت من main.dart's _AuthGate عند
// تسجيل الدخول وعند رجوع التطبيق من الخلفية (نفس لحظة إعادة اتصال presence socket بالظبط) —
// طبقة موثوقية إضافية فوق الشاشة، مش بديل عنها.
Future<bool> captureLocationSilently(OnboardingRepository repository) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return false;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
    );
    await repository.updateLocation(position.latitude, position.longitude);
    return true;
  } catch (_) {
    return false;
  }
}
