import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SeoService } from './seo.service';

/**
 * **الصفحات العامة للظهور في البحث** (ADR-0113).
 *
 * كل المسارات `@Public()` عن قصد ومحسوبة: الزاحف (جوجل، أدوات الـAI) مالوش حساب ومالوش توكن.
 * ومفيش أي بيانات شخصية هنا — اسم خدمة، محتوى كتبه الأدمن للنشر، وأسماء مناطق مُطلَقة.
 *
 * السقف واسع (١٢٠/دقيقة) لأن الزاحف بيسحب صفحات كتير في دفعة واحدة، وتضييقه كان بيخلي
 * الفهرسة نفسها تفشل — وهي الغرض من الموديول ده.
 */
@Controller('seo')
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  /** قايمة الفوتر. */
  @Get('services')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async listServices() {
    return this.seo.listPublishedServices();
  }

  /** كل مسارات الـsitemap — الموقع بيبنيه من النداء الواحد ده. */
  @Get('sitemap')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async sitemap() {
    return this.seo.sitemapEntries();
  }

  /**
   * صفحة الخدمة، أو الخدمة × المنطقة لما `?area=` تتبعت.
   *
   * **مسار واحد للحالتين** مش اتنين: الصفحتين نفس المحتوى بالظبط والفرق هو المنطقة في العنوان
   * وفي `h1`. مسارين معناهم نسختين من نفس الاستعلام، وأول تعديل على واحد بيخلي الصفحتين
   * يقولوا حاجتين مختلفتين.
   */
  @Get('services/:slug')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async getService(@Param('slug') slug: string, @Query('area') areaSlug?: string) {
    const service = await this.seo.findPublishedService(slug);
    const areas = await this.seo.listLaunchedAreas();
    // منطقة مش مُطلَقة أو مش موجودة ⇒ `area: null`، والموقع بيرجّع 404 للصفحة دي. مابنرميش من
    // هنا عشان صفحة الخدمة بلا منطقة تفضل تشتغل من نفس النداء.
    const area = areaSlug ? (areas.find((a) => a.slug === areaSlug) ?? null) : null;
    return {
      // **`id` مطلوب لزرار الحجز**: صفحة الحجز على الموقع هي `/services/{id}` (مسار موجود
      // وبيشتغل)، فالزرار بيوصّل لهناك مباشرةً بدل ما يطلّع الزائر من الموقع.
      id: service.id,
      slug: service.slug,
      name_ar: service.nameAr,
      short_description_ar: service.shortDescriptionAr ?? null,
      seo_content_ar: service.seoContentAr,
      updated_at: service.updatedAt.toISOString(),
      area,
      areas,
      area_requested: areaSlug ?? null,
    };
  }
}
