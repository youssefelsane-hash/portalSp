import '../../core/auth_repository.dart';
import 'models.dart';

// الجدولة الحقيقية للفني (docs/08 §2-§3) — الفني بيدير جدوله بنفسه، نفس فلسفة المالك بالحرف
// ("يخش كل أسبوع يحط اللي هو فاضي فيه"). كانت الشاشة دي فجوة موثّقة صراحة: الـ endpoints
// (POST/GET/DELETE /technician/schedule) كانت شغالة ومختبرة بالـ curl بس مفيش أي واجهة حقيقية
// في التطبيق تستخدمها — الفني معندوش طريقة يحدد أوقات توافره غير على مستوى on/off عام.
class ScheduleRepository {
  final AuthRepository auth;

  ScheduleRepository(this.auth);

  Future<List<ScheduleSlot>> list({String? from, String? to}) async {
    final query = <String, String>{
      if (from != null) 'from': from,
      if (to != null) 'to': to,
    };
    final path = query.isEmpty ? '/technician/schedule' : '/technician/schedule?${Uri(queryParameters: query).query}';
    final items = await auth.authedRequestList(path);
    return items.map(ScheduleSlot.fromJson).toList();
  }

  Future<ScheduleSlot> create({
    required String slotDate,
    required String startTime,
    required String endTime,
    String? notesAr,
  }) async {
    final data = await auth.authedRequest('POST', '/technician/schedule', body: {
      'slot_date': slotDate,
      'start_time': startTime,
      'end_time': endTime,
      if (notesAr != null && notesAr.isNotEmpty) 'notes_ar': notesAr,
    });
    return ScheduleSlot.fromJson(data!);
  }

  Future<void> delete(String slotId) async {
    await auth.authedRequest('DELETE', '/technician/schedule/$slotId');
  }

  /// تعديل جماعي سريع للإتاحة (docs/08 §34.3) — نطاق تواريخ كامل بنداء واحد بدل يوم بيوم.
  /// `action` إما `block` (تعليم الأيام دي "غير متاح") أو `unblock` (رجوعها للافتراضي "متاح").
  Future<void> bulkSetAvailability({
    required List<String> dates,
    required String action,
    String? notesAr,
  }) async {
    await auth.authedRequest('POST', '/technician/schedule/bulk', body: {
      'dates': dates,
      'action': action,
      if (notesAr != null && notesAr.isNotEmpty) 'notes_ar': notesAr,
    });
  }
}
