// اختبار وحدة بسيط للـ parsing — بيتأكد إن الأنواع مطابقة فعلياً لشكل استجابة apps/api
// الحقيقي (نسخة طبق الأصل من apps/api/src/modules/catalog/dto/service-response.dto.ts).
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/features/catalog/models.dart';

void main() {
  test('ServiceCategory.fromJson بيقرأ استجابة حقيقية من /service-categories', () {
    final json = {
      'id': '019fddf7-0000-0000-0000-000000000001',
      'parent_category_id': null,
      'name_ar': 'سباكة',
      'name_en': 'Plumbing',
      'slug': 'plumbing',
      'icon_url': null,
    };
    final category = ServiceCategory.fromJson(json);
    expect(category.id, '019fddf7-0000-0000-0000-000000000001');
    expect(category.nameAr, 'سباكة');
    expect(category.parentCategoryId, isNull);
  });

  test('CatalogService.fromJson بيقرأ استجابة حقيقية من /services', () {
    final json = {
      'id': '019fddf7-0000-0000-0000-000000000002',
      'category_id': '019fddf7-0000-0000-0000-000000000001',
      'name_ar': 'تسليك مواسير',
      'name_en': null,
      'slug': 'unclog-pipes',
      'short_description_ar': 'تسليك مواسير الحمام والمطبخ',
      'pricing_model': 'fixed',
      'base_price_cents': 30000,
      'inspection_fee_cents': 0,
      'unit_name_ar': null,
      'estimated_duration_minutes': 60,
      'warranty_days': 14,
      'requires_photos': true,
      'allows_scheduling': true,
      'allows_emergency': false,
      'min_technician_level': 'new',
    };
    final service = CatalogService.fromJson(json);
    expect(service.nameAr, 'تسليك مواسير');
    expect(service.basePriceCents, 30000);
    expect(service.allowsEmergency, false);
  });
}
