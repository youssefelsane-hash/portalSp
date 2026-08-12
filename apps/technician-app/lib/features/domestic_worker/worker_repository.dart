import '../../core/auth_repository.dart';
import 'models.dart';

// بروفايل الشغالة/العامل المنزلي (docs/08 §12, ADR-0004, ADR-0005) — كانت فجوة موثّقة صراحة:
// الباك-إند (بروفايل/موقع/حجوزات) كان شغال ومختبر حي من زمان بصفر شاشة تستخدمه.
class WorkerRepository {
  final AuthRepository auth;

  WorkerRepository(this.auth);

  Future<WorkerMe> fetchMe() async {
    final data = await auth.authedRequest('GET', '/domestic-worker/me');
    return WorkerMe.fromJson(data!);
  }

  Future<WorkerMe> updateProfile({
    String? bio,
    int? yearsOfExperience,
    List<String>? specialties,
    int? hourlyRateCents,
    int? monthlyRateCents,
  }) async {
    final data = await auth.authedRequest('PATCH', '/domestic-worker/profile', body: {
      if (bio != null) 'bio': bio,
      if (yearsOfExperience != null) 'years_of_experience': yearsOfExperience,
      if (specialties != null) 'specialties': specialties,
      if (hourlyRateCents != null) 'hourly_rate_cents': hourlyRateCents,
      if (monthlyRateCents != null) 'monthly_rate_cents': monthlyRateCents,
    });
    return WorkerMe.fromJson(data!);
  }

  // إدخال يدوي للإحداثيات (مش مسح/GPS تلقائي) — نفس القرار الموثّق لعناوين apps/customer-app:
  // مفيش جهاز/إيموليتور حقيقي في بيئة التطوير لاختبار إذن الموقع حياً.
  Future<void> updateLocation(double latitude, double longitude) async {
    await auth.authedRequest('POST', '/domestic-worker/location', body: {
      'latitude': latitude,
      'longitude': longitude,
    });
  }

  Future<WorkerMe> requestReview() async {
    final data = await auth.authedRequest('POST', '/domestic-worker/request-review');
    return WorkerMe.fromJson(data!);
  }

  Future<List<WorkerBooking>> listBookings() async {
    final items = await auth.authedRequestList('/domestic-worker/bookings');
    return items.map(WorkerBooking.fromJson).toList();
  }

  Future<WorkerBooking> confirmBooking(String id) async {
    final data = await auth.authedRequest('POST', '/domestic-worker/bookings/$id/confirm');
    return WorkerBooking.fromJson(data!);
  }

  Future<WorkerBooking> completeBooking(String id) async {
    final data = await auth.authedRequest('POST', '/domestic-worker/bookings/$id/complete');
    return WorkerBooking.fromJson(data!);
  }
}
