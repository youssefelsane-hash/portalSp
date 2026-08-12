import '../../core/api_client.dart';
import 'models.dart';

// /service-categories و/services عامة (Public()) — مفيش داعي access_token، أي حد يقدر يتصفح الكتالوج.
class CatalogRepository {
  Future<List<ServiceCategory>> fetchCategories() async {
    final items = await apiRequestList('/service-categories');
    return items.map(ServiceCategory.fromJson).toList();
  }

  Future<List<CatalogService>> fetchServices({String? categoryId, BookingMode? bookingMode}) async {
    final params = <String, String>{
      if (categoryId != null) 'category_id': categoryId,
      if (bookingMode != null) 'booking_mode': bookingMode.apiValue,
    };
    final query = params.isEmpty ? '' : '?${Uri(queryParameters: params).query}';
    final items = await apiRequestList('/services$query');
    return items.map(CatalogService.fromJson).toList();
  }

  // مستخدمة في "إعادة الحجز" — عندنا service_id بس من الطلب القديم، محتاجين الكائن الكامل
  // عشان نفتح CreateOrderScreen عليه.
  Future<CatalogService> fetchService(String serviceId) async {
    final data = await apiRequest('GET', '/services/$serviceId');
    return CatalogService.fromJson(data!);
  }

  Future<List<ServiceAddon>> fetchAddons(String serviceId) async {
    final items = await apiRequestList('/services/$serviceId/addons');
    return items.map(ServiceAddon.fromJson).toList();
  }

  // محرك التسعير الديناميكي (docs/08 §1) — بس للخدمات pricing_model=formula، الفورم اللي
  // CreateOrderScreen بيرسمه ديناميكيًا بدل السعر الثابت.
  Future<List<PricingField>> fetchPricingFields(String serviceId) async {
    final items = await apiRequestList('/services/$serviceId/pricing-fields');
    return items.map(PricingField.fromJson).toList();
  }
}
