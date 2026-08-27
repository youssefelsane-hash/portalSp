import { TechnicianPortfolioLink } from '../entities/technician-portfolio-link.entity';

export interface PortfolioLinkResponseDto {
  id: string;
  platform: string;
  url: string;
  title: string | null;
  thumbnail_url: string | null;
  /** بَقّة حقيقية اتلقطت (docs/08 §81) — الـID الفعلي اللي oEmbed استخرجه وقت الإضافة (تيك توك
   * بس حاليًا). الكلاينت لازم يفضّله على تفكيك الرابط الخام بـregex محلي — راجع apps/customer-app's
   * portfolio_embed_url.dart. null = لينك قبل الإصلاح، أو oEmbed فشل وقت الإضافة. */
  embed_video_id: string | null;
  display_order: number;
}

export function toPortfolioLinkResponseDto(link: TechnicianPortfolioLink): PortfolioLinkResponseDto {
  return {
    id: link.id,
    platform: link.platform,
    url: link.url,
    title: link.title,
    thumbnail_url: link.thumbnailUrl,
    embed_video_id: link.embedVideoId,
    display_order: link.displayOrder,
  };
}
