// هيكل الحجز الجديد (docs/06 §1) — التلات أزرار اللي العميل بيختارهم قبل ما يشوف الخدمات.
// مطابق بالحرف لـ orders.entity.ts's BookingMode في الباك-إند.
enum BookingMode { individual, team, emergency }

extension BookingModeJson on BookingMode {
  String get apiValue => switch (this) {
        BookingMode.individual => 'individual',
        BookingMode.team => 'team',
        BookingMode.emergency => 'emergency',
      };

  // الأسماء المعتمدة (docs/07 §الفجوات المفتوحة #2، مُعدَّلة docs/08 §32.3 طلب مالك صريح
  // 2026-08-20) — "أفراد" اتجنّبت عمداً كعنوان زرار من الأول. "شغلانة سريعة" (القرار الأصلي)
  // اتشالت كمان — وصف "سريعة/بسرعة" بيوحي بالاستعجال ويتلخبط مع وضع "طوارئ" الفعلي، رغم إن
  // الوضعين مختلفين تمامًا (فردي = فني واحد بيتولى الشغلانة، مفيش علاقة بسرعة التنفيذ).
  String get labelAr => switch (this) {
        BookingMode.individual => 'فردي',
        BookingMode.team => 'اعتماد',
        BookingMode.emergency => 'طوارئ',
      };

  // عكس apiValue — لازم لطلب إعادة الزيارة (docs/08 §7): بنعيد استخدام booking_mode بتاع
  // الطلب الأصلي (نص من الـAPI) عشان ننشئ طلب جديد بنفس الوضع.
  static BookingMode fromApiValue(String value) => switch (value) {
        'team' => BookingMode.team,
        'emergency' => BookingMode.emergency,
        _ => BookingMode.individual,
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
  // Script 6 Part 1-2 — صورة غلاف فعلية للكارت (كانت فجوة موثّقة صراحة: العمود موجود في
  // الـschema من زمان بس مش معروض للعميل خالص قبل كده). null لو الأدمن لسه ما حطهاش —
  // الشاشة بترجع لـiconUrl، وبعدها لـplaceholder عام (NetworkImageBox).
  final String? coverImageUrl;
  // Script 3 §14 — فئات شائعة حقيقية (مُعدّة من الأدمن)، مش مفبركة.
  final bool isFeatured;

  ServiceCategory({
    required this.id,
    required this.parentCategoryId,
    required this.nameAr,
    required this.nameEn,
    required this.slug,
    required this.iconUrl,
    required this.coverImageUrl,
    required this.isFeatured,
  });

  // أول صورة متاحة فعليًا للكارت (غلاف ثم أيقونة) — مصدر حقيقة واحد بدل ما كل شاشة تكرر نفس
  // منطق fallback السلسلة.
  String? get cardImageUrl => coverImageUrl ?? iconUrl;

  factory ServiceCategory.fromJson(Map<String, dynamic> json) => ServiceCategory(
        id: json['id'] as String,
        parentCategoryId: json['parent_category_id'] as String?,
        nameAr: json['name_ar'] as String,
        nameEn: json['name_en'] as String,
        slug: json['slug'] as String,
        iconUrl: json['icon_url'] as String?,
        coverImageUrl: json['cover_image_url'] as String?,
        isFeatured: json['is_featured'] as bool? ?? false,
      );
}

class CatalogService {
  final String id;
  final String categoryId;
  final String nameAr;
  final String? shortDescriptionAr;
  // Script 6 Part 1-2 — كانت فجوة موثّقة صراحة: موجودة في DTO الأدمن من زمان بس مش معروضة
  // للعميل قبل كده.
  final String? iconUrl;
  final String pricingModel;
  final int basePriceCents;
  final int inspectionFeeCents;
  final bool allowsScheduling;
  final bool allowsEmergency;
  // هيكل الحجز الجديد (docs/06 §1) — كانت فجوة موثّقة صراحة: الموديول القديم كان بيقرا
  // allows_emergency بس، مش allows_individual/allows_team رغم إنهم موجودين في رد الباك-إند من
  // زمان (service-response.dto.ts) — اكتشفت وقت بناء "الطلبات المتكررة" لما القالب كان بيتقبل
  // بـbooking_mode=individual افتراضي حتى لو الخدمة أصلاً مش بتدعمه، فيفشل توليد الطلب بصمت للأبد.
  final bool allowsIndividual;
  final bool allowsTeam;
  // قدرة "نطاق أيام مرن" (ADR-0028، docs/08 §42 Phase A.2) — لو false، ScheduleSelectionScreen
  // بتخفي كارت "مرن — اختار نطاق أيام" بدل ما تسيب العميل يختاره ويترفض من الباك-إند بعدين.
  final bool allowsDateRangeBooking;
  // قدرة "الحجز المتكرر" (migration 0176) — لو false، مفيش خيارات تكرار (مرة واحدة/أسبوعي/شهري)
  // ظاهرة في CreateOrderScreen خالص، والباك-إند بيرفض repeat_frequency للخدمة دي برضه.
  // nullable مع fallback false عشان التوافق مع ردود قديمة محتملة.
  final bool allowsRecurringBooking;
  // قدرة دفع لكل خدمة (ADR-0026، docs/08 §42 Phase A.1) — كانت فجوة موثّقة صراحة: العمود موجود
  // في رد الباك-إند من زمان بس مش مقروء هنا خالص، فـCreateOrderScreen كان بيعرض "ادفع بعد الخدمة"
  // (كاش) لكل خدمة بلا استثناء حتى لو الباك-إند هيرفضها. false يعني الكاش ممنوع صراحة.
  final bool cashAllowed;
  // دقة الوقت (ADR-0031 Slice B) — لو true، العميل لازم يحدد بداية + مدة بالساعات (duration_hours)
  // بدل يوم كامل بس. نفس نمط allowsDateRangeBooking بالحرف.
  final bool requiresPreciseSchedule;
  // 3 أوضاع توقيت جديدة (ADR-0032) — تبادلية مع requiresPreciseSchedule فوق ومع بعض (الباك-إند
  // بيضمن ده بـCHECK constraint، على الأكتر وضع واحد true في نفس الوقت لأي خدمة).
  final bool requiresStartTimeOnly;
  final bool requiresHoursOnly;
  final bool requiresStartAndEnd;

  CatalogService({
    required this.id,
    required this.categoryId,
    required this.nameAr,
    required this.shortDescriptionAr,
    required this.iconUrl,
    required this.pricingModel,
    required this.basePriceCents,
    required this.inspectionFeeCents,
    required this.allowsScheduling,
    required this.allowsEmergency,
    required this.allowsIndividual,
    required this.allowsTeam,
    required this.allowsDateRangeBooking,
    required this.allowsRecurringBooking,
    required this.cashAllowed,
    required this.requiresPreciseSchedule,
    required this.requiresStartTimeOnly,
    required this.requiresHoursOnly,
    required this.requiresStartAndEnd,
  });

  factory CatalogService.fromJson(Map<String, dynamic> json) => CatalogService(
        id: json['id'] as String,
        categoryId: json['category_id'] as String,
        nameAr: json['name_ar'] as String,
        shortDescriptionAr: json['short_description_ar'] as String?,
        iconUrl: json['icon_url'] as String?,
        pricingModel: json['pricing_model'] as String,
        basePriceCents: json['base_price_cents'] as int,
        inspectionFeeCents: json['inspection_fee_cents'] as int,
        allowsScheduling: json['allows_scheduling'] as bool,
        allowsEmergency: json['allows_emergency'] as bool,
        allowsIndividual: json['allows_individual'] as bool,
        allowsTeam: json['allows_team'] as bool,
        allowsDateRangeBooking: json['allows_date_range_booking'] as bool,
        allowsRecurringBooking: json['allows_recurring_booking'] as bool? ?? false,
        cashAllowed: json['cash_allowed'] as bool? ?? true,
        requiresPreciseSchedule: json['requires_precise_schedule'] as bool? ?? false,
        requiresStartTimeOnly: json['requires_start_time_only'] as bool? ?? false,
        requiresHoursOnly: json['requires_hours_only'] as bool? ?? false,
        requiresStartAndEnd: json['requires_start_and_end'] as bool? ?? false,
      );

  // أول وضع حجز متاح فعليًا للخدمة دي، بترتيب أولوية فرد > فريق > طوارئ — مستخدم في القوالب
  // المتكررة عشان مانبعتش booking_mode مش متاح للخدمة (الباك-إند بيرفضه بوضوح لو حصل).
  BookingMode? get defaultAllowedBookingMode {
    if (allowsIndividual) return BookingMode.individual;
    if (allowsTeam) return BookingMode.team;
    if (allowsEmergency) return BookingMode.emergency;
    return null;
  }

  // Script 3 §32/§35 — كل أوضاع الحجز المسموحة فعليًا للخدمة دي، بنفس ترتيب الأولوية. بتستخدم
  // في تحديد هل نسأل العميل "إزاي حابب تحجز؟" أصلاً (لو وضع واحد بس، مفيش داعي نسأل خالص — بند
  // 35: "Do not show Company/Team unnecessarily for simple services").
  List<BookingMode> get availableBookingModes => [
        if (allowsIndividual) BookingMode.individual,
        if (allowsTeam) BookingMode.team,
        if (allowsEmergency) BookingMode.emergency,
      ];
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

// محرك الإنتاجية (docs/06 §3.1-§3.6) — مطابق لـ apps/api/src/modules/catalog/dto/standard-data-response.dto.ts.
// كانت فجوة موثّقة صراحة: estimate-duration محتاجة id ده، بس مفيش endpoint عام يوفّره أصلاً.
class ServiceStandardDataRow {
  final String id;
  final String executionTypeAr;
  final String unitAr;

  ServiceStandardDataRow({required this.id, required this.executionTypeAr, required this.unitAr});

  factory ServiceStandardDataRow.fromJson(Map<String, dynamic> json) => ServiceStandardDataRow(
        id: json['id'] as String,
        executionTypeAr: json['execution_type_ar'] as String,
        unitAr: json['unit_ar'] as String,
      );
}

// مطابق لرد POST /services/:id/estimate-duration — المدة المتوقعة بس، من غير أي تكلفة داخلية
// (docs/06 §3.6 صريح: مش المفروض تتعرض للعميل).
class DurationEstimate {
  final num estimatedDays;
  final String unitAr;
  final String executionTypeAr;

  DurationEstimate({required this.estimatedDays, required this.unitAr, required this.executionTypeAr});

  factory DurationEstimate.fromJson(Map<String, dynamic> json) => DurationEstimate(
        estimatedDays: json['estimated_days'] as num,
        unitAr: json['unit_ar'] as String,
        executionTypeAr: json['execution_type_ar'] as String,
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
