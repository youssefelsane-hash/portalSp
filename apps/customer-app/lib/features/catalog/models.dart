// مطابق لـ apps/api/src/modules/catalog/dto/service-response.dto.ts
class ServiceCategory {
  final String id;
  final String? parentCategoryId;
  final String nameAr;
  final String nameEn;
  final String slug;
  final String? iconUrl;

  ServiceCategory({
    required this.id,
    required this.parentCategoryId,
    required this.nameAr,
    required this.nameEn,
    required this.slug,
    required this.iconUrl,
  });

  factory ServiceCategory.fromJson(Map<String, dynamic> json) => ServiceCategory(
        id: json['id'] as String,
        parentCategoryId: json['parent_category_id'] as String?,
        nameAr: json['name_ar'] as String,
        nameEn: json['name_en'] as String,
        slug: json['slug'] as String,
        iconUrl: json['icon_url'] as String?,
      );
}

class CatalogService {
  final String id;
  final String categoryId;
  final String nameAr;
  final String? shortDescriptionAr;
  final String pricingModel;
  final int basePriceCents;
  final int inspectionFeeCents;
  final bool allowsScheduling;
  final bool allowsEmergency;

  CatalogService({
    required this.id,
    required this.categoryId,
    required this.nameAr,
    required this.shortDescriptionAr,
    required this.pricingModel,
    required this.basePriceCents,
    required this.inspectionFeeCents,
    required this.allowsScheduling,
    required this.allowsEmergency,
  });

  factory CatalogService.fromJson(Map<String, dynamic> json) => CatalogService(
        id: json['id'] as String,
        categoryId: json['category_id'] as String,
        nameAr: json['name_ar'] as String,
        shortDescriptionAr: json['short_description_ar'] as String?,
        pricingModel: json['pricing_model'] as String,
        basePriceCents: json['base_price_cents'] as int,
        inspectionFeeCents: json['inspection_fee_cents'] as int,
        allowsScheduling: json['allows_scheduling'] as bool,
        allowsEmergency: json['allows_emergency'] as bool,
      );
}
