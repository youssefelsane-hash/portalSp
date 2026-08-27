import '../../core/api_client.dart';
import 'models.dart';

// /service-categories و/services عامة (Public()) — مفيش داعي access_token، أي حد يقدر يتصفح الكتالوج.
class CatalogRepository {
  Future<List<ServiceCategory>> fetchCategories() async {
    final items = await apiRequestList('/service-categories');
    return items.map(ServiceCategory.fromJson).toList();
  }

  /// «الأكثر طلبًا» — **من عدد الطلبات الحقيقي** (docs/08 §77-E2).
  ///
  /// كان التطبيق بيفلتر الفئات محليًا بـ`isFeatured` — يعني العنوان يقول «الأكثر طلبًا»
  /// والمصدر «اللي الأدمن اختاره». المسار ده بيخلّي الاسم يطابق القياس: السيرفر بيعدّ الطلبات
  /// الحقيقية في نافذة متحركة، وبيرجع لاختيار الأدمن بس لو مفيش أي طلبات لسه.
  Future<List<ServiceCategory>> fetchMostRequestedCategories() async {
    final items = await apiRequestList('/service-categories/most-requested');
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

  // Script 3 §6/§7 — وصف طبيعي/بحث بديل عن تصفح الفئات ("المياه بتنزل من تحت الحوض" بدل
  // "سباكة"). GET /services/search?q=... (aliases/substring، مش AI — catalog.service.ts's
  // searchServices()). أقل من حرفين محليًا برضه (مطابق لفحص الباك-إند) عشان مانبعتش طلبات فاضية.
  Future<List<CatalogService>> searchServices(String q) async {
    final trimmed = q.trim();
    if (trimmed.length < 2) return [];
    final items = await apiRequestList('/services/search?${Uri(queryParameters: {'q': trimmed}).query}');
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

  // محرك الإنتاجية (docs/06 §3.1-§3.6) — كانت فجوة موثّقة صراحة: مفيش UI بيعرض المدة المتوقعة
  // للعميل قبل الحجز لخدمات غير formula (اللي بتعتمد على service_standard_data). الاتنين تحت
  // مستقلين عن محرك التسعير الديناميكي بالكامل — نظام أقدم منفصل عمدًا (راجع catalog/README.md).
  Future<List<ServiceStandardDataRow>> fetchStandardData(String serviceId) async {
    final items = await apiRequestList('/services/$serviceId/standard-data');
    return items.map(ServiceStandardDataRow.fromJson).toList();
  }

  Future<DurationEstimate> estimateDuration(String serviceId, String standardDataId, num requestedUnits) async {
    final data = await apiRequest('POST', '/services/$serviceId/estimate-duration', body: {
      'standard_data_id': standardDataId,
      'requested_units': requestedUnits,
    });
    return DurationEstimate.fromJson(data!);
  }
}
