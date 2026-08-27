// "اعتماد" (docs/06 §1.5) — مطابق لـ apps/api/src/modules/technicians/dto/company-response.dto.ts's
// PublicCompanyResponseDto. العميل يختار من القايمة دي عشان يحجز شركة/فريق بعينه.
class TechnicianCompanySummary {
  final String id;
  final String name;
  final int branchCount;
  final int staffCount;
  // صورة الشركة (ADR-0031) — أفتار المالك المعتمد نفسه، مفيش رفع منفصل للشركة.
  final String? avatarUrl;

  TechnicianCompanySummary({
    required this.id,
    required this.name,
    required this.branchCount,
    required this.staffCount,
    required this.avatarUrl,
  });

  factory TechnicianCompanySummary.fromJson(Map<String, dynamic> json) => TechnicianCompanySummary(
        id: json['id'] as String,
        name: json['name'] as String,
        branchCount: json['branch_count'] as int,
        staffCount: json['staff_count'] as int,
        avatarUrl: json['avatar_url'] as String?,
      );
}

// الجدولة الحقيقية للفني (docs/08 §2-§3) — مطابق لـ
// apps/api/src/modules/technicians/dto/schedule-slot-response.dto.ts's PublicScheduleSlotResponseDto.
// نسخة العميل (عبر GET /technicians/:id/schedule) — is_available بس، مفيش order_id/notes داخلية.
class ScheduleSlot {
  final String id;
  final String slotDate;
  final String startTime;
  final String endTime;
  final bool isAvailable;

  ScheduleSlot({
    required this.id,
    required this.slotDate,
    required this.startTime,
    required this.endTime,
    required this.isAvailable,
  });

  factory ScheduleSlot.fromJson(Map<String, dynamic> json) => ScheduleSlot(
        id: json['id'] as String,
        slotDate: json['slot_date'] as String,
        startTime: json['start_time'] as String,
        endTime: json['end_time'] as String,
        isAvailable: json['is_available'] as bool,
      );
}

// اختيار الفني قبل الحجز (docs/08 §3) — مطابق لـ
// apps/api/src/modules/technicians/dto/technician-booking-list-response.dto.ts. قايمة فنيين
// مؤهّلين للخدمة في منطقة العميل، مرتبة (تقييم ثم قرب ثم طلبات مكتملة) من الباك-إند.
const Map<String, String> technicianLevelLabelsAr = {
  'new': 'جديد',
  'verified': 'موثّق',
  'professional': 'محترف',
  'premium': 'مميز',
  'team_leader': 'قائد فريق',
};

class TechnicianBookingListItem {
  final String id;
  final String fullName;
  final String? avatarUrl;
  final String? bio;
  final double averageRating;
  final int totalRatingsCount;
  final int completedOrdersCount;
  final double? distanceKm;
  // مضاعف سعر مستوى الفني (docs/08) — العميل لازم يشوف رتبة كل فني مرشّح والسعر النهائي المحسوب
  // فعليًا بيه قبل ما يختاره. final_price_cents/level_price_multiplier = null لخدمات formula.
  final String technicianLevel;
  final int? finalPriceCents;
  final double? levelPriceMultiplier;
  // علامة التوثيق الزرقاء (ADR-0039، docs/08 §62.1) — **مِنحة إدارية**، مش نتيجة تلقائية لاعتماد
  // الأوراق. فأغلب الصفوف في القايمة دي هتبقى false، وده الوضع الصحيح مش نقص بيانات.
  // onTimeRatePercent/avgArrivalMinutes بيرجعوا null لو مفيش طلبات كفاية لحساب متوسط منها
  // (مش صفر مضلّل).
  final bool isVerified;
  final int? onTimeRatePercent;
  final int? avgArrivalMinutes;
  // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38) — id هنا يبقى معرّف الشركة لو isCompany.
  final bool isCompany;
  final int? staffCount;
  final int? branchCount;
  // وجود سجل تجاري (docs/08 §62.2) — هو الفرق الحقيقي بين "شركة مسجّلة" و"فريق عمل" في البيانات.
  final bool isCommercialCompany;
  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030 Slice B/D) — 'available' دايمًا للسلوك
  // القديم (بلا scheduled_at، أو service.showUnavailableProviders=false). 'schedule_conflicted'
  // معناه الفني مؤهّل فعلاً بس محجوز في الفترة المطلوبة — الباك-إند بيرجّعه صراحة (بدل الإخفاء)
  // بس للخدمات المفعّل فيها الإعداد ده.
  final String availabilityStatus;
  final String? unavailableReasonAr;
  final DateTime? availableAgainAt;

  bool get isScheduleConflicted => availabilityStatus == 'schedule_conflicted';

  TechnicianBookingListItem({
    required this.id,
    required this.fullName,
    required this.avatarUrl,
    required this.bio,
    required this.averageRating,
    required this.totalRatingsCount,
    required this.completedOrdersCount,
    required this.distanceKm,
    required this.technicianLevel,
    required this.finalPriceCents,
    required this.levelPriceMultiplier,
    required this.isVerified,
    required this.onTimeRatePercent,
    required this.avgArrivalMinutes,
    required this.isCompany,
    required this.staffCount,
    required this.branchCount,
    required this.isCommercialCompany,
    this.availabilityStatus = 'available',
    this.unavailableReasonAr,
    this.availableAgainAt,
  });

  factory TechnicianBookingListItem.fromJson(Map<String, dynamic> json) => TechnicianBookingListItem(
        id: json['id'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        bio: json['bio'] as String?,
        averageRating: (json['average_rating'] as num).toDouble(),
        totalRatingsCount: json['total_ratings_count'] as int,
        completedOrdersCount: json['completed_orders_count'] as int,
        distanceKm: (json['distance_km'] as num?)?.toDouble(),
        technicianLevel: json['technician_level'] as String? ?? 'new',
        finalPriceCents: json['final_price_cents'] as int?,
        levelPriceMultiplier: (json['level_price_multiplier'] as num?)?.toDouble(),
        isVerified: json['is_verified'] as bool? ?? false,
        onTimeRatePercent: json['on_time_rate'] as int?,
        avgArrivalMinutes: json['avg_arrival_minutes'] as int?,
        isCompany: json['is_company'] as bool? ?? false,
        staffCount: json['staff_count'] as int?,
        branchCount: json['branch_count'] as int?,
        isCommercialCompany: json['is_commercial_company'] as bool? ?? false,
        availabilityStatus: json['availability_status'] as String? ?? 'available',
        unavailableReasonAr: json['unavailable_reason_ar'] as String?,
        availableAgainAt:
            json['available_again_at'] != null ? DateTime.parse(json['available_again_at'] as String) : null,
      );
}

class TechnicianZoneInfo {
  final String id;
  final String nameAr;

  TechnicianZoneInfo({required this.id, required this.nameAr});

  factory TechnicianZoneInfo.fromJson(Map<String, dynamic> json) =>
      TechnicianZoneInfo(id: json['id'] as String, nameAr: json['name_ar'] as String);
}

class TechnicianServiceInfo {
  final String id;
  final String nameAr;
  final int basePriceCents;

  TechnicianServiceInfo({required this.id, required this.nameAr, required this.basePriceCents});

  factory TechnicianServiceInfo.fromJson(Map<String, dynamic> json) => TechnicianServiceInfo(
        id: json['id'] as String,
        nameAr: json['name_ar'] as String,
        basePriceCents: json['base_price_cents'] as int,
      );
}

class PortfolioLink {
  final String id;
  final String platform;
  final String url;
  final String? title;
  final String? thumbnailUrl;
  // بَقّة حقيقية اتلقطت (docs/08 §81) — الـID الفعلي اللي الباك-إند استخرجه من oEmbed وقت
  // الإضافة (تيك توك بس حاليًا). بيتفضّل على تفكيك url الخام بـregex محلي في buildPortfolioEmbedUrl
  // (بيفشل مع short links زي vm.tiktok.com). null = لينك قبل الإصلاح، أو oEmbed فشل وقتها.
  final String? embedVideoId;

  PortfolioLink({
    required this.id,
    required this.platform,
    required this.url,
    required this.title,
    required this.thumbnailUrl,
    required this.embedVideoId,
  });

  factory PortfolioLink.fromJson(Map<String, dynamic> json) => PortfolioLink(
        id: json['id'] as String,
        platform: json['platform'] as String,
        url: json['url'] as String,
        title: json['title'] as String?,
        thumbnailUrl: json['thumbnail_url'] as String?,
        embedVideoId: json['embed_video_id'] as String?,
      );
}

// الشهادات (docs/08) — كانت فجوة UI موثّقة صراحة: GET /technicians/:id/profile بيرجّع
// certificates المعتمدة بس (approved)، بس مفيش أي شاشة في customer-app بتعرضها للعميل خالص.
// مطابق لـ apps/api/src/modules/technicians/dto/certificate-response.dto.ts's
// PublicCertificateResponseDto — نسخة عامة محدودة عمدًا (بدون تفاصيل المراجعة الداخلية).
class TechnicianCertificate {
  final String id;
  final String title;
  final String? issuerName;
  final String? issuedAt;
  final String fileUrl;

  TechnicianCertificate({
    required this.id,
    required this.title,
    required this.issuerName,
    required this.issuedAt,
    required this.fileUrl,
  });

  factory TechnicianCertificate.fromJson(Map<String, dynamic> json) => TechnicianCertificate(
        id: json['id'] as String,
        title: json['title'] as String,
        issuerName: json['issuer_name'] as String?,
        issuedAt: json['issued_at'] as String?,
        fileUrl: json['file_url'] as String,
      );
}

class TechnicianReview {
  final int overallRating;
  final String? comment;
  final DateTime createdAt;

  TechnicianReview({required this.overallRating, required this.comment, required this.createdAt});

  factory TechnicianReview.fromJson(Map<String, dynamic> json) => TechnicianReview(
        overallRating: json['overall_rating'] as int,
        comment: json['comment'] as String?,
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class TechnicianPublicProfile {
  final String id;
  final String technicianCode;
  final String fullName;
  final String? avatarUrl;
  final String? bio;
  final int yearsOfExperience;
  final String verificationStatus;
  final double averageRating;
  final int totalRatingsCount;
  final int completedOrdersCount;
  final int? cancellationRate;
  final int? onTimeRate;
  // كانت فجوة موثّقة صراحة (docs/08 §4) — الباك-إند بيحسبهم ويرجّعهم في GET /technicians/:id/profile
  // من زمان، بس مفيش شاشة كانت بتقراهم أو تعرضهم للعميل خالص.
  final int? avgArrivalMinutes;
  final int? avgCompletionMinutes;
  final List<TechnicianZoneInfo> zones;
  final List<TechnicianServiceInfo> services;
  final List<TechnicianReview> recentReviews;
  final List<PortfolioLink> portfolioLinks;
  final List<TechnicianCertificate> certificates;

  TechnicianPublicProfile({
    required this.id,
    required this.technicianCode,
    required this.fullName,
    required this.avatarUrl,
    required this.bio,
    required this.yearsOfExperience,
    required this.verificationStatus,
    required this.isTrustVerified,
    required this.averageRating,
    required this.totalRatingsCount,
    required this.completedOrdersCount,
    required this.cancellationRate,
    required this.onTimeRate,
    required this.avgArrivalMinutes,
    required this.avgCompletionMinutes,
    required this.zones,
    required this.services,
    required this.recentReviews,
    required this.portfolioLinks,
    required this.certificates,
  });

  // ADR-0039 (docs/08 §62.1) — كانت مشتقة من `verificationStatus == 'approved'`، يعني أي فني
  // معتمد تشغيليًا كان بياخد العلامة الزرقاء تلقائيًا. بقت الحقل اللي الأدمن بيتحكم فيه فعلاً.
  final bool isTrustVerified;
  bool get isVerified => isTrustVerified;

  factory TechnicianPublicProfile.fromJson(Map<String, dynamic> json) => TechnicianPublicProfile(
        id: json['id'] as String,
        technicianCode: json['technician_code'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        bio: json['bio'] as String?,
        yearsOfExperience: json['years_of_experience'] as int,
        verificationStatus: json['verification_status'] as String,
        isTrustVerified: json['is_trust_verified'] as bool? ?? false,
        averageRating: (json['average_rating'] as num).toDouble(),
        totalRatingsCount: json['total_ratings_count'] as int,
        completedOrdersCount: json['completed_orders_count'] as int,
        cancellationRate: json['cancellation_rate'] as int?,
        onTimeRate: json['on_time_rate'] as int?,
        avgArrivalMinutes: json['avg_arrival_minutes'] as int?,
        avgCompletionMinutes: json['avg_completion_minutes'] as int?,
        zones: (json['zones'] as List).map((z) => TechnicianZoneInfo.fromJson(z as Map<String, dynamic>)).toList(),
        services: (json['services'] as List)
            .map((s) => TechnicianServiceInfo.fromJson(s as Map<String, dynamic>))
            .toList(),
        recentReviews: (json['recent_reviews'] as List)
            .map((r) => TechnicianReview.fromJson(r as Map<String, dynamic>))
            .toList(),
        portfolioLinks: (json['portfolio_links'] as List)
            .map((p) => PortfolioLink.fromJson(p as Map<String, dynamic>))
            .toList(),
        certificates: (json['certificates'] as List)
            .map((c) => TechnicianCertificate.fromJson(c as Map<String, dynamic>))
            .toList(),
      );
}
