import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SettingsService } from '../settings/settings.service';
import { AddPortfolioLinkDto } from './dto/add-portfolio-link.dto';
import { PortfolioLinkPlatform, TechnicianPortfolioLink } from './entities/technician-portfolio-link.entity';

const MAX_LINKS_PER_TECHNICIAN = 12;

interface OembedPreview {
  thumbnailUrl: string | null;
  title: string | null;
}

/**
 * تيك توك ويوتيوب عندهم oEmbed عام بلا أي مفتاح. انستجرام/فيسبوك بقى محتاج Facebook Graph API
 * access token حقيقي (`social.facebook_graph_access_token` في /settings) — من غيره بنتجاهل
 * جلب المعاينة بأمان (اللينك لسه بيتحفظ عادي، بس من غير thumbnail). راجع
 * docs/03-external-integrations.md للحصول على المفتاح ده.
 */
@Injectable()
export class PortfolioLinksService {
  private readonly logger = new Logger(PortfolioLinksService.name);

  constructor(
    @InjectRepository(TechnicianPortfolioLink) private readonly links: Repository<TechnicianPortfolioLink>,
    private readonly settingsService: SettingsService,
  ) {}

  detectPlatform(url: string): PortfolioLinkPlatform {
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      throw new ApiException(ErrorCode.VAL_001, 'الرابط غير صالح', HttpStatus.BAD_REQUEST);
    }
    if (host.includes('tiktok.com')) return PortfolioLinkPlatform.TIKTOK;
    if (host.includes('youtube.com') || host === 'youtu.be') return PortfolioLinkPlatform.YOUTUBE;
    if (host.includes('instagram.com')) return PortfolioLinkPlatform.INSTAGRAM;
    if (host.includes('facebook.com') || host === 'fb.watch') return PortfolioLinkPlatform.FACEBOOK;
    throw new ApiException(
      ErrorCode.VAL_001,
      'الرابط لازم يكون من تيك توك أو يوتيوب أو انستجرام أو فيسبوك',
      HttpStatus.BAD_REQUEST,
    );
  }

  /** فشل صامت ومقصود في كل خطوة — معاينة ناقصة أبداً ميمنعش حفظ اللينك نفسه. */
  private async fetchOembedPreview(platform: PortfolioLinkPlatform, url: string): Promise<OembedPreview> {
    try {
      const oembedUrl = await this.buildOembedUrl(platform, url);
      if (!oembedUrl) return { thumbnailUrl: null, title: null };

      const res = await fetch(oembedUrl);
      if (!res.ok) {
        this.logger.warn(`oEmbed رجّع ${res.status} لـ ${platform}: ${url}`);
        return { thumbnailUrl: null, title: null };
      }
      const data = (await res.json()) as { thumbnail_url?: string; title?: string };
      return { thumbnailUrl: data.thumbnail_url ?? null, title: data.title ?? null };
    } catch (err) {
      this.logger.warn(`فشل جلب oEmbed لـ ${platform} (${url}): ${err instanceof Error ? err.message : err}`);
      return { thumbnailUrl: null, title: null };
    }
  }

  private async buildOembedUrl(platform: PortfolioLinkPlatform, url: string): Promise<string | null> {
    const encoded = encodeURIComponent(url);
    switch (platform) {
      case PortfolioLinkPlatform.TIKTOK:
        return `https://www.tiktok.com/oembed?url=${encoded}`;
      case PortfolioLinkPlatform.YOUTUBE:
        return `https://www.youtube.com/oembed?url=${encoded}&format=json`;
      case PortfolioLinkPlatform.INSTAGRAM:
      case PortfolioLinkPlatform.FACEBOOK: {
        const token = await this.settingsService.getString('social.facebook_graph_access_token', '');
        if (!token) return null; // مفيش مفتاح لسه — نتجاهل بأمان بدل ما نبعت نداء هيفشل أكيد
        const endpoint =
          platform === PortfolioLinkPlatform.INSTAGRAM
            ? 'https://graph.facebook.com/v18.0/instagram_oembed'
            : 'https://graph.facebook.com/v18.0/oembed_video';
        return `${endpoint}?url=${encoded}&access_token=${encodeURIComponent(token)}`;
      }
    }
  }

  async addLink(technicianId: string, dto: AddPortfolioLinkDto): Promise<TechnicianPortfolioLink> {
    const existingCount = await this.links.count({ where: { technicianId } });
    if (existingCount >= MAX_LINKS_PER_TECHNICIAN) {
      throw new ApiException(
        ErrorCode.VAL_001,
        `أقصى عدد لينكات معرض أعمال هو ${MAX_LINKS_PER_TECHNICIAN}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const platform = this.detectPlatform(dto.url);
    const preview = await this.fetchOembedPreview(platform, dto.url);

    const link = this.links.create({
      technicianId,
      platform,
      url: dto.url,
      title: dto.title ?? preview.title,
      thumbnailUrl: preview.thumbnailUrl,
      displayOrder: existingCount,
    });
    return this.links.save(link);
  }

  listForTechnician(technicianId: string): Promise<TechnicianPortfolioLink[]> {
    return this.links.find({ where: { technicianId }, order: { displayOrder: 'ASC', createdAt: 'ASC' } });
  }

  async remove(technicianId: string, linkId: string): Promise<void> {
    const link = await this.links.findOne({ where: { id: linkId } });
    if (!link || link.technicianId !== technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'اللينك غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.links.remove(link);
  }
}
