import '../../core/auth_repository.dart';
import '../catalog/models.dart' show BookingMode, BookingModeJson;
import 'models.dart';

// الجدولة المستقبلية/المتكررة (docs/08 §11) — العميل بيدير قوالبه الخاصة بس (/me/recurring-orders).
class RecurringOrdersRepository {
  final AuthRepository auth;

  RecurringOrdersRepository(this.auth);

  Future<List<RecurringTemplate>> list() async {
    final items = await auth.authedRequestList('/me/recurring-orders');
    return items.map(RecurringTemplate.fromJson).toList();
  }

  Future<RecurringTemplate> create({
    required String serviceId,
    required String addressId,
    // لازم يكون وضع متاح فعليًا للخدمة دي (service.allowsIndividual/allowsTeam/allowsEmergency) —
    // الباك-إند بيرفض غير كده صراحة (فحص جديد اتضاف مع الشاشة دي، كان مفقود قبل كده تمامًا).
    required BookingMode bookingMode,
    required String frequency,
    required String startsAt,
    String? problemDescription,
  }) async {
    final data = await auth.authedRequest('POST', '/me/recurring-orders', body: {
      'service_id': serviceId,
      'address_id': addressId,
      'booking_mode': bookingMode.apiValue,
      'frequency': frequency,
      'starts_at': startsAt,
      if (problemDescription != null && problemDescription.isNotEmpty) 'problem_description': problemDescription,
    });
    return RecurringTemplate.fromJson(data!);
  }

  // إيقاف/استئناف مؤقت بس — تعديل الخدمة/العنوان/التردد مش مدعوم عمداً في الباك-إند
  // (راجع تعليق UpdateRecurringTemplateDto — أبسط للعميل إنه يلغي وينشئ قالب جديد).
  Future<RecurringTemplate> setActive(String id, bool isActive) async {
    final data = await auth.authedRequest('PATCH', '/me/recurring-orders/$id', body: {'is_active': isActive});
    return RecurringTemplate.fromJson(data!);
  }

  Future<void> remove(String id) async {
    await auth.authedRequest('DELETE', '/me/recurring-orders/$id');
  }
}
