import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Service } from '../catalog/entities/service.entity';
import { Area } from '../geo/entities/area.entity';
import { City } from '../geo/entities/city.entity';

/** منطقة مُطلَقة زي ما الصفحة العامة محتاجاها. */
export interface SeoArea {
  slug: string;
  name_ar: string;
  city_name_ar: string;
}

@Injectable()
export class SeoService {
  constructor(
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(Area) private readonly areas: Repository<Area>,
    @InjectRepository(City) private readonly cities: Repository<City>,
  ) {}

  /**
   * **الخدمات المنشورة** — وجود `seo_content_ar` هو مفتاح النشر (ADR-0113 §2).
   *
   * `Not(IsNull())` **مش كفاية لوحده**: عمود نصي يقدر يبقى `''`. `admin-catalog.service` بيحوّل
   * النص الفاضي لـNULL عند الحفظ، بس الفحص هنا بيغطّي أي صف قديم أو كتابة من بره المسار ده —
   * صفحة منشورة على محتوى فاضي هي بالظبط «صفحة رقيقة» اللي بتضر الظهور بدل ما تفيده.
   */
  private publishedWhere() {
    return { seoContentAr: Not(IsNull()), deletedAt: IsNull(), isActive: true };
  }

  private isPublished(service: Service): boolean {
    return (service.seoContentAr ?? '').trim().length > 0;
  }

  /** قايمة الفوتر — أخف استعلام ممكن: الحقول المعروضة بس. */
  async listPublishedServices(): Promise<{ slug: string; name_ar: string; short_description_ar: string | null }[]> {
    const rows = await this.services.find({
      where: this.publishedWhere(),
      select: ['slug', 'nameAr', 'shortDescriptionAr', 'seoContentAr'],
      order: { nameAr: 'ASC' },
    });
    return rows.filter((s) => this.isPublished(s)).map((s) => ({
      slug: s.slug,
      name_ar: s.nameAr,
      short_description_ar: s.shortDescriptionAr ?? null,
    }));
  }

  /**
   * **المناطق المُطلَقة بس** (ADR-0113 §4).
   *
   * `areas` و`service_zones` مش مربوطين في القاعدة — الأولى دقّة عنوان العميل والتانية دقّة
   * التوزيع، والاتنين معلّقين على `cities`. فمفيش طريقة نجيب «الخدمة متاحة في المنطقة دي؟» على
   * مستوى المنطقة. `is_launched` هو **إشارة المشغّل نفسه** على المناطق اللي فيها خدمة فعلية،
   * وهو أصدق حاجة متاحة — وصفحة لمنطقة مش مخدومة وعد مكسور ومسؤولية SEO مش مكسب.
   */
  async listLaunchedAreas(): Promise<SeoArea[]> {
    const [areas, cities] = await Promise.all([
      this.areas.find({
        where: { isLaunched: true, isActive: true, deletedAt: IsNull() },
        select: ['slug', 'nameAr', 'cityId'],
        order: { nameAr: 'ASC' },
      }),
      this.cities.find({ where: { deletedAt: IsNull() }, select: ['id', 'nameAr'] }),
    ]);
    const cityName = new Map(cities.map((c) => [c.id, c.nameAr]));
    return areas
      // منطقة مدينتها اتشالت مابتظهرش — العنوان «الخدمة في المنطقة، مدينة …» بيبقى ناقص.
      .filter((a) => cityName.has(a.cityId))
      .map((a) => ({ slug: a.slug, name_ar: a.nameAr, city_name_ar: cityName.get(a.cityId)! }));
  }

  /** خدمة منشورة بالسلَج. بترمي 404 لو مش منشورة — نفس رد «مش موجودة» بالظبط. */
  async findPublishedService(slug: string): Promise<Service> {
    const service = await this.services.findOne({ where: { ...this.publishedWhere(), slug } });
    if (!service || !this.isPublished(service)) {
      // **نفس رد الغياب** عن قصد: خدمة موجودة بلا محتوى SEO مالهاش صفحة، وتمييزها عن خدمة
      // مش موجودة خالص بيكشف الكتالوج الداخلي لأي حد بيجرّب سلَجات.
      throw new ApiException(ErrorCode.VAL_001, 'الصفحة غير موجودة', HttpStatus.NOT_FOUND);
    }
    return service;
  }

  /** منطقة مُطلَقة بالسلَج، أو null. المُنادي بيقرر يرمي 404 ولا يعرض الصفحة بلا منطقة. */
  async findLaunchedArea(slug: string): Promise<SeoArea | null> {
    const areas = await this.listLaunchedAreas();
    return areas.find((a) => a.slug === slug) ?? null;
  }

  /**
   * كل مسارات الـsitemap في نداء واحد.
   *
   * الضرب الكامل (كل خدمة × كل منطقة) مقصود: ده بالظبط سطح الفهرسة اللي الميزة موجودة عشانه،
   * وبيتولّد من **نفس** المصدرين اللي الصفحات بتقراهم فمستحيل الـsitemap يعلن صفحة بترجّع 404.
   */
  async sitemapEntries(): Promise<{ path: string; updated_at: string }[]> {
    const [services, areas] = await Promise.all([
      this.services.find({ where: this.publishedWhere(), select: ['slug', 'updatedAt', 'seoContentAr'] }),
      this.listLaunchedAreas(),
    ]);
    const published = services.filter((s) => this.isPublished(s));
    const entries: { path: string; updated_at: string }[] = [];
    for (const service of published) {
      const updated = service.updatedAt.toISOString();
      entries.push({ path: `/services/${service.slug}`, updated_at: updated });
      for (const area of areas) {
        entries.push({ path: `/services/${service.slug}/${area.slug}`, updated_at: updated });
      }
    }
    return entries;
  }
}
