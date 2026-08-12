import { TechnicianBookingListItem } from '../technicians.service';

export interface TechnicianBookingListItemResponseDto {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  distance_km: number | null;
}

export function toTechnicianBookingListItemResponseDto(item: TechnicianBookingListItem): TechnicianBookingListItemResponseDto {
  return {
    id: item.technicianId,
    full_name: item.fullName,
    avatar_url: item.avatarUrl,
    bio: item.bio,
    average_rating: item.averageRating,
    total_ratings_count: item.totalRatingsCount,
    completed_orders_count: item.serviceCompletedCount,
    distance_km: item.distanceKm !== null ? Math.round(item.distanceKm * 100) / 100 : null,
  };
}
