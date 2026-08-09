import '../../core/api_client.dart';
import 'models.dart';

// /service-categories و/services عامة (Public()) — مفيش داعي access_token، أي حد يقدر يتصفح الكتالوج.
class CatalogRepository {
  Future<List<ServiceCategory>> fetchCategories() async {
    final items = await apiRequestList('/service-categories');
    return items.map(ServiceCategory.fromJson).toList();
  }

  Future<List<CatalogService>> fetchServices({String? categoryId}) async {
    final query = categoryId != null ? '?category_id=$categoryId' : '';
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
}
