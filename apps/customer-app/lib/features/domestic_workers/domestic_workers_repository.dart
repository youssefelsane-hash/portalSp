import '../../core/auth_repository.dart';
import 'models.dart';

// قطاع الخدمات المنزلية (docs/08 §12, ADR-0004) — كيان مستقل تمامًا عن orders/technicians،
// كانت فجوة موثّقة صراحة: الباك-إند كامل ومختبر حي من سيشن سابقة، بصفر شاشة في أي تطبيق.
class DomesticWorkersRepository {
  final AuthRepository auth;

  DomesticWorkersRepository(this.auth);

  // ADR-0030 Slice C/D — scheduledAt اختياري: لو اتحدد، الباك-إند بيفحص تعارض جدولي حقيقي
  // (كان صفر فحص قبل كده في المسار ده) ويفلتر الشغالات المتعارضة تلقائيًا. serviceId مش متوفر
  // في الشاشة دي حاليًا (تصفّح بالتخصص، مش بخدمة كتالوج محددة — فجوة معمارية موثّقة في ADR-0030)،
  // فالافتراضي الآمن هو الإخفاء الكامل بدل عرض حالة schedule_conflicted.
  Future<List<PublicWorker>> browse({
    String? specialty,
    double? latitude,
    double? longitude,
    DateTime? scheduledAt,
  }) async {
    final params = <String, String>{
      if (specialty != null) 'specialty': specialty,
      if (latitude != null) 'latitude': latitude.toString(),
      if (longitude != null) 'longitude': longitude.toString(),
      if (scheduledAt != null) 'scheduled_at': scheduledAt.toUtc().toIso8601String(),
    };
    final query = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final items = await auth.authedRequestList('/domestic-workers$query');
    return items.map(PublicWorker.fromJson).toList();
  }

  Future<PublicWorker> getOne(String id) async {
    final data = await auth.authedRequest('GET', '/domestic-workers/$id');
    return PublicWorker.fromJson(data!);
  }

  Future<WorkerBooking> createBooking({
    required String workerId,
    required String addressId,
    required String specialty,
    required String bookingType,
    required String scheduledAt,
    int? durationHours,
    bool? autoRenew,
    String? customerNotes,
  }) async {
    final data = await auth.authedRequest('POST', '/domestic-worker-bookings', body: {
      'worker_id': workerId,
      'address_id': addressId,
      'specialty': specialty,
      'booking_type': bookingType,
      'scheduled_at': scheduledAt,
      if (durationHours != null) 'duration_hours': durationHours,
      if (autoRenew != null) 'auto_renew': autoRenew,
      if (customerNotes != null && customerNotes.isNotEmpty) 'customer_notes': customerNotes,
    });
    return WorkerBooking.fromJson(data!);
  }

  Future<List<WorkerBooking>> listBookings() async {
    final items = await auth.authedRequestList('/domestic-worker-bookings');
    return items.map(WorkerBooking.fromJson).toList();
  }

  Future<WorkerBooking> cancelBooking(String id, {String? reason}) async {
    final data = await auth.authedRequest('POST', '/domestic-worker-bookings/$id/cancel', body: {
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    });
    return WorkerBooking.fromJson(data!);
  }
}
