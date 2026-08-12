import '../../core/auth_repository.dart';
import 'models.dart';

class TechniciansRepository {
  final AuthRepository auth;

  TechniciansRepository(this.auth);

  Future<TechnicianPublicProfile> fetchPublicProfile(String technicianId) async {
    final data = await auth.authedRequest('GET', '/technicians/$technicianId/profile');
    return TechnicianPublicProfile.fromJson(data!);
  }

  // "اعتماد" (docs/06 §1.5) — الشركات/الفرق النشطة اللي العميل يقدر يحجزها كاملة.
  Future<List<TechnicianCompanySummary>> listActiveCompanies() async {
    final items = await auth.authedRequestList('/technician-companies');
    return items.map(TechnicianCompanySummary.fromJson).toList();
  }

  // الجدولة الحقيقية للفني (docs/08 §2-§3) — العميل يشوف السلوتات الفاضية/المحجوزة (أخضر/أحمر)
  // بتاعة فني بعينه ويختار واحد منها وقت الحجز. مش @Public() في الباك-إند (محتاج توكن عميل عادي).
  Future<List<ScheduleSlot>> fetchSchedule(String technicianId) async {
    final items = await auth.authedRequestList('/technicians/$technicianId/schedule');
    return items.map(ScheduleSlot.fromJson).toList();
  }
}
