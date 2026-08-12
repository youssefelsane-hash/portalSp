// هيكل الحجز الجديد (docs/06 §1) — التلات أزرار اللي العميل بيختارهم قبل ما يشوف الخدمات.
// مطابق بالحرف لـ orders.entity.ts's BookingMode في الباك-إند.
enum BookingMode { individual, team, emergency }

extension BookingModeJson on BookingMode {
  String get apiValue => switch (this) {
        BookingMode.individual => 'individual',
        BookingMode.team => 'team',
        BookingMode.emergency => 'emergency',
      };

  // الأسماء المعتمدة (docs/07 §الفجوات المفتوحة #2) — "أفراد" اتجنّبت عمداً كعنوان زرار.
  String get labelAr => switch (this) {
        BookingMode.individual => 'شغلانة سريعة',
        BookingMode.team => 'اعتماد',
        BookingMode.emergency => 'طوارئ',
      };
}

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

// محرك التسعير الديناميكي (docs/08 §1) — مطابق لـ apps/api/src/modules/pricing/dto/pricing-response.dto.ts.
// أنواع الحقول اللي عندها widget مخصص هنا (راجع CreateOrderScreen): number/area/length/volume
// (رقم بوحدة)، dropdown، multi_select، checkbox، slider، date، time. الأنواع التانية
// (location/image_upload/video_upload/voice_note) **مش مدعومة لسه في الفورم الديناميكي** —
// فجوة موثّقة صراحة في customer-app/README.md (محتاجة camera/gps permissions ومكتبات إضافية،
// خارج نطاق ربط محرك التسعير بمسار الحجز نفسه). لو حقل من النوع ده `is_required=true`،
// الفورم بيمنع الإرسال ويوضّح السبب بدل ما يبعت قيمة ناقصة تترفض بخطأ عام من الباك-إند.
const Set<String> unsupportedPricingFieldTypes = {'location', 'image_upload', 'video_upload', 'voice_note'};

class PricingFieldOption {
  final String value;
  final String labelAr;

  PricingFieldOption({required this.value, required this.labelAr});

  factory PricingFieldOption.fromJson(Map<String, dynamic> json) =>
      PricingFieldOption(value: json['value'] as String, labelAr: json['label_ar'] as String);
}

class PricingField {
  final String id;
  final String fieldKey;
  final String labelAr;
  final String fieldType;
  final bool isRequired;
  final String? unitAr;
  final List<PricingFieldOption>? options;
  final num? minValue;
  final num? maxValue;

  PricingField({
    required this.id,
    required this.fieldKey,
    required this.labelAr,
    required this.fieldType,
    required this.isRequired,
    required this.unitAr,
    required this.options,
    required this.minValue,
    required this.maxValue,
  });

  bool get isSupported => !unsupportedPricingFieldTypes.contains(fieldType);

  factory PricingField.fromJson(Map<String, dynamic> json) => PricingField(
        id: json['id'] as String,
        fieldKey: json['field_key'] as String,
        labelAr: json['label_ar'] as String,
        fieldType: json['field_type'] as String,
        isRequired: json['is_required'] as bool,
        unitAr: json['unit_ar'] as String?,
        options: (json['options'] as List<dynamic>?)
            ?.map((o) => PricingFieldOption.fromJson(o as Map<String, dynamic>))
            .toList(),
        minValue: json['min_value'] as num?,
        maxValue: json['max_value'] as num?,
      );
}

// مطابق لـ apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts (ServiceAddonResponseDto)
// — نفس الشكل يرجع من GET /services/:id/addons العامة.
class ServiceAddon {
  final String id;
  final String nameAr;
  final int priceCents;

  ServiceAddon({required this.id, required this.nameAr, required this.priceCents});

  factory ServiceAddon.fromJson(Map<String, dynamic> json) => ServiceAddon(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        priceCents: json['price_cents'] as int,
      );
}
