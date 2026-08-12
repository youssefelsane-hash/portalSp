import '../../core/api_client.dart' as api_client;
import '../../core/auth_repository.dart';
import 'models.dart';

class TechniciansRepository {
  final AuthRepository auth;

  TechniciansRepository(this.auth);

  // اختيار الفني قبل الحجز (docs/08 §3) — @Public() في الباك-إند (GET /services/:id/technicians)،
  // بس محتاج address_id عشان يحسب المسافة/يفلتر على المنطقة. كانت فجوة موثّقة صراحة: الـendpoint
  // ده مختبر حي من سيشن سابقة بس مفيش أي شاشة في apps/customer-app بتناديه — العميل مكانش يقدر
  // يختار فني بنفسه قبل الحجز أصلاً، auto-match بس. اتقفلت (TechnicianSelectionScreen).
  Future<List<TechnicianBookingListItem>> listForService(
    String serviceId,
    String addressId, {
    String? excludeTechnicianId,
  }) async {
    // سياسة إلغاء الفني (docs/10) — excludeTechnicianId بيتبعت وقت اختيار فني بديل بعد ما فني
    // لغى، عشان نفس الفني مايظهرش تاني في القايمة.
    final query = excludeTechnicianId != null ? '&exclude_technician_id=$excludeTechnicianId' : '';
    final items = await api_client.apiRequestList('/services/$serviceId/technicians?address_id=$addressId$query');
    return items.map(TechnicianBookingListItem.fromJson).toList();
  }

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
