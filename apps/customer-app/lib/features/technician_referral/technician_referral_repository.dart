import '../../core/auth_repository.dart';

// ترشيح QR للفني (docs/11 §1) — عميل مسجّل بالفعل بيستخدم كود ترشيح فني (مسح QR/إدخال يدوي).
// عميل جديد بياخد نفس التأثير تلقائيًا وقت التسجيل (راجع AuthRepository.register()).
class TechnicianReferralRepository {
  final AuthRepository auth;

  TechnicianReferralRepository(this.auth);

  Future<void> attribute(String referralCode) async {
    await auth.authedRequest('POST', '/me/technician-referral', body: {'referral_code': referralCode});
  }
}
