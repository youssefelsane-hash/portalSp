import { FavoriteTechnicianSummary } from '../favorites.service';

export interface FavoriteTechnicianResponseDto {
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  favorited_at: string;
}

export function toFavoriteTechnicianResponseDto(item: FavoriteTechnicianSummary): FavoriteTechnicianResponseDto {
  return {
    technician_id: item.technicianId,
    full_name: item.fullName,
    avatar_url: item.avatarUrl,
    average_rating: item.averageRating,
    total_ratings_count: item.totalRatingsCount,
    completed_orders_count: item.completedOrdersCount,
    favorited_at: item.favoritedAt.toISOString(),
  };
}
