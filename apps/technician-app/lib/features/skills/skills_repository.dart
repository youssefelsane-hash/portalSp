import '../../core/auth_repository.dart';
import 'models.dart';

// تصريح مهارات ذاتي (Script 4 §2-7) — كانت فجوة موثّقة صراحة: technician_services كان 100%
// معيّن من الأدمن يدوياً، الفني مالوش أي مسار يطلب خدمة بنفسه. التصريح وحده مايديش أهلية مطابقة
// فورية — بيدخل طابور مراجعة أدمن (pending_verification)، راجع apps/api's technicians/README.md.
class SkillsRepository {
  final AuthRepository auth;

  SkillsRepository(this.auth);

  Future<List<TechnicianServiceDeclaration>> listMyServices() async {
    final items = await auth.authedRequestList('/technician/services');
    return items.map(TechnicianServiceDeclaration.fromJson).toList();
  }

  Future<TechnicianServiceDeclaration> declare(
    String serviceId, {
    String skillLevel = 'standard',
  }) async {
    final data = await auth.authedRequest(
      'POST',
      '/technician/services',
      body: {'service_id': serviceId, 'skill_level': skillLevel},
    );
    return TechnicianServiceDeclaration.fromJson(data!);
  }

  Future<void> withdraw(String id) async {
    await auth.authedRequest('DELETE', '/technician/services/$id');
  }

  // تصفّح الكتالوج الديناميكي الموجود بالفعل (@Public()، نفس endpoints العميل بالحرف — مفيش
  // كتالوج تاني منفصل للفني) — هرمي (فئة → خدمة) عشان الفني ميشوفش مئات الخدمات في شاشة واحدة.
  Future<List<ServiceCategoryOption>> listCategories() async {
    final items = await auth.authedRequestList('/service-categories');
    return items.map(ServiceCategoryOption.fromJson).toList();
  }

  Future<List<ServiceOption>> listServicesForCategory(String categoryId) async {
    final items = await auth.authedRequestList(
      '/services?category_id=$categoryId',
    );
    return items.map(ServiceOption.fromJson).toList();
  }
}
