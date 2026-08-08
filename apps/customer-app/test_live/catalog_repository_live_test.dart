// اختبار حي حقيقي — بيكلم apps/api شغال فعلاً على localhost:3000. مختلف عن باقي اختبارات
// الـ widgets في المشروع ده: test() العادي (مش testWidgets()) معندوش قيد الـ HTTP client
// اللي TestWidgetsFlutterBinding بيفرضه (بيرجع 400 لأي نداء شبكة حقيقي) — فده المسار الوحيد
// اللي قدرنا فيه نتأكد حياً إن كود الـ HTTP بتاعنا شغال ضد الباك-إند الحقيقي، رغم مفيش
// emulator/device في البيئة دي (راجع apps/customer-app/README.md للتفاصيل الكاملة).
// شغّله بـ: flutter test test_live/catalog_repository_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/catalog/catalog_repository.dart';

void main() {
  test('CatalogRepository بيجيب فئات وخدمات حقيقية من apps/api', () async {
    final repository = CatalogRepository();

    final categories = await repository.fetchCategories();
    expect(categories, isNotEmpty);
    expect(categories.first.nameAr, isNotEmpty);

    final services = await repository.fetchServices(categoryId: categories.first.id);
    for (final service in services) {
      expect(service.categoryId, categories.first.id);
    }
  });
}
