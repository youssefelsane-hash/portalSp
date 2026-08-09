import { TechnicianPortfolioLink } from '../entities/technician-portfolio-link.entity';

export interface PortfolioLinkResponseDto {
  id: string;
  platform: string;
  url: string;
  title: string | null;
  thumbnail_url: string | null;
  display_order: number;
}

export function toPortfolioLinkResponseDto(link: TechnicianPortfolioLink): PortfolioLinkResponseDto {
  return {
    id: link.id,
    platform: link.platform,
    url: link.url,
    title: link.title,
    thumbnail_url: link.thumbnailUrl,
    display_order: link.displayOrder,
  };
}
