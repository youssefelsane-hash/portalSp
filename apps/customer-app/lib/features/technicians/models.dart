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
  final List<TechnicianZoneInfo> zones;
  final List<TechnicianServiceInfo> services;
  final List<TechnicianReview> recentReviews;

  TechnicianPublicProfile({
    required this.id,
    required this.technicianCode,
    required this.fullName,
    required this.avatarUrl,
    required this.bio,
    required this.yearsOfExperience,
    required this.verificationStatus,
    required this.averageRating,
    required this.totalRatingsCount,
    required this.completedOrdersCount,
    required this.cancellationRate,
    required this.onTimeRate,
    required this.zones,
    required this.services,
    required this.recentReviews,
  });

  bool get isVerified => verificationStatus == 'approved';

  factory TechnicianPublicProfile.fromJson(Map<String, dynamic> json) => TechnicianPublicProfile(
        id: json['id'] as String,
        technicianCode: json['technician_code'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        bio: json['bio'] as String?,
        yearsOfExperience: json['years_of_experience'] as int,
        verificationStatus: json['verification_status'] as String,
        averageRating: (json['average_rating'] as num).toDouble(),
        totalRatingsCount: json['total_ratings_count'] as int,
        completedOrdersCount: json['completed_orders_count'] as int,
        cancellationRate: json['cancellation_rate'] as int?,
        onTimeRate: json['on_time_rate'] as int?,
        zones: (json['zones'] as List).map((z) => TechnicianZoneInfo.fromJson(z as Map<String, dynamic>)).toList(),
        services: (json['services'] as List)
            .map((s) => TechnicianServiceInfo.fromJson(s as Map<String, dynamic>))
            .toList(),
        recentReviews: (json['recent_reviews'] as List)
            .map((r) => TechnicianReview.fromJson(r as Map<String, dynamic>))
            .toList(),
      );
}
