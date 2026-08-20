import '../../core/auth_repository.dart';
import 'models.dart';

// تصريح تخصص ذاتي بمستوى الفئة (§29) — بدّل تصريح المهارات خدمة-بخدمة القديم (Script 4 §2-7)
// بالكامل. الفني بيصرّح بفئة كاملة (سباكة، كهرباء...) بدل خدمة فردية — التصريح وحده مايديش أهلية
// مطابقة فورية، بيدخل طابور مراجعة أدمن (pending_verification) زي القديم بالظبط.
class SkillsRepository {
  final AuthRepository auth;

  SkillsRepository(this.auth);

  Future<List<TechnicianCategoryDeclaration>> listMyCategories() async {
    final items = await auth.authedRequestList('/technician/categories');
    return items.map(TechnicianCategoryDeclaration.fromJson).toList();
  }

  Future<TechnicianCategoryDeclaration> declare(String categoryId) async {
    final data = await auth.authedRequest(
      'POST',
      '/technician/categories',
      body: {'category_id': categoryId},
    );
    return TechnicianCategoryDeclaration.fromJson(data!);
  }

  Future<void> withdraw(String id) async {
    await auth.authedRequest('DELETE', '/technician/categories/$id');
  }

  // تصفّح الكتالوج الديناميكي الموجود بالفعل (@Public()، نفس endpoint العميل بالحرف) — قايمة
  // الفئات الكبيرة بس، مفيش تدرّج لخدمات فرعية هنا خالص (§29 — الفني بيصرّح بالفئة كلها مرة واحدة).
  Future<List<ServiceCategoryOption>> listCategories() async {
    final items = await auth.authedRequestList('/service-categories');
    return items.map(ServiceCategoryOption.fromJson).toList();
  }
}
