// مطابق لـ apps/api/src/modules/favorites/dto/favorite-technician-response.dto.ts
export interface FavoriteTechnicianResponseDto {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  favorited_at: string;
}

export interface FavoriteStatusResponseDto {
  is_favorited: boolean;
}
