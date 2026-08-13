// المفضّلة (Favorites، docs/10 بند 36) — مطابق لـ
// apps/api/src/modules/favorites/dto/favorite-technician-response.dto.ts.
class FavoriteTechnician {
  final String technicianId;
  final String fullName;
  final String? avatarUrl;
  final double averageRating;
  final int totalRatingsCount;
  final int completedOrdersCount;
  final String favoritedAt;

  FavoriteTechnician({
    required this.technicianId,
    required this.fullName,
    required this.avatarUrl,
    required this.averageRating,
    required this.totalRatingsCount,
    required this.completedOrdersCount,
    required this.favoritedAt,
  });

  factory FavoriteTechnician.fromJson(Map<String, dynamic> json) => FavoriteTechnician(
        technicianId: json['technician_id'] as String,
        fullName: json['full_name'] as String,
        avatarUrl: json['avatar_url'] as String?,
        averageRating: (json['average_rating'] as num).toDouble(),
        totalRatingsCount: json['total_ratings_count'] as int,
        completedOrdersCount: json['completed_orders_count'] as int,
        favoritedAt: json['favorited_at'] as String,
      );
}
