import { TechnicianProfile } from '../entities/technician-profile.entity';
import { TechnicianPortfolioLink } from '../entities/technician-portfolio-link.entity';
import { toPortfolioLinkResponseDto, PortfolioLinkResponseDto } from './portfolio-link-response.dto';

export interface PublicTechnicianProfileResponseDto {
  id: string;
  technician_code: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  years_of_experience: number;
  verification_status: string;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  /** null = مفيش بيانات كفاية لسه (مش صفر — صفر معناه فعلاً 0%). */
  cancellation_rate: number | null;
  /** null = مفيش طلبات مجدولة (scheduled_at) اتنفّذت لسه يتحسب عليها الالتزام بالمواعيد. */
  on_time_rate: number | null;
  zones: { id: string; name_ar: string }[];
  services: { id: string; name_ar: string; base_price_cents: number }[];
  recent_reviews: { overall_rating: number; comment: string | null; created_at: string }[];
  portfolio_links: PortfolioLinkResponseDto[];
}

export function toPublicTechnicianProfileResponseDto(data: {
  profile: TechnicianProfile;
  fullName: string;
  avatarUrl: string | null;
  zones: { id: string; nameAr: string }[];
  services: { id: string; nameAr: string; basePriceCents: number }[];
  recentReviews: { overallRating: number; comment: string | null; createdAt: Date }[];
  onTimeRate: number | null;
  portfolioLinks: TechnicianPortfolioLink[];
}): PublicTechnicianProfileResponseDto {
  const { profile } = data;
  const totalDecided = profile.completedOrdersCount + profile.cancelledOrdersCount;
  const cancellationRate = totalDecided > 0 ? Math.round((profile.cancelledOrdersCount / totalDecided) * 100) : null;

  return {
    id: profile.id,
    technician_code: profile.technicianCode,
    full_name: data.fullName,
    avatar_url: data.avatarUrl,
    bio: profile.bio,
    years_of_experience: profile.yearsOfExperience,
    verification_status: profile.verificationStatus,
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_orders_count: profile.completedOrdersCount,
    cancellation_rate: cancellationRate,
    on_time_rate: data.onTimeRate,
    zones: data.zones.map((z) => ({ id: z.id, name_ar: z.nameAr })),
    services: data.services.map((s) => ({ id: s.id, name_ar: s.nameAr, base_price_cents: s.basePriceCents })),
    recent_reviews: data.recentReviews.map((r) => ({
      overall_rating: r.overallRating,
      comment: r.comment,
      created_at: r.createdAt.toISOString(),
    })),
    portfolio_links: data.portfolioLinks.map(toPortfolioLinkResponseDto),
  };
}
