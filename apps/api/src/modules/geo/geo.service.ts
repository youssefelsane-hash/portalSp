import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { ServiceZone } from './entities/service-zone.entity';

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    @InjectRepository(City) private readonly cities: Repository<City>,
    @InjectRepository(Area) private readonly areas: Repository<Area>,
    @InjectRepository(ServiceZone) private readonly serviceZones: Repository<ServiceZone>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * **بَقّة حقيقية اتلقطت في التدقيق الماراثوني (2026-09-14، docs/08 §148)**: الاستعلام القديم
   * كان بيرجّع أي مدينة `is_active` حتى لو مالهاش ولا منطقة مُطلَقة. العميل بيختارها في نموذج
   * العنوان، `GET /cities/:id/areas` بيرجّع قايمة فاضية، فالقايمة المنسدلة بتفضل فاضية
   * والـvalidator بيقول «مطلوب» من غير أي تفسير — طريق مسدود صامت، والعميل مش قادر يحجز خالص.
   * ونفس القايمة دي بتتعرض كـ«المدن اللي بنغطيها» في customer-web، فمدينة من غير منطقة مُطلَقة
   * كانت بتبقى **ادّعاء تغطية غير صحيح**. المدينة اللي مفيهاش منطقة قابلة للحجز مش تغطية.
   */
  findActiveCities(): Promise<City[]> {
    return this.cities
      .createQueryBuilder('city')
      .where('city.is_active = true')
      .andWhere(
        `EXISTS (
           SELECT 1 FROM areas area
           WHERE area.city_id = city.id
             AND area.is_launched = true
             AND area.is_active = true
             AND area.deleted_at IS NULL
         )`,
      )
      .orderBy('city.name_ar', 'ASC')
      .getMany();
  }

  /** استخدام عام عبر الموديولات (مش بس geo) — للتحقق إن نطاق خدمة موجود قبل ربطه بحاجة تانية. */
  async findServiceZoneOrThrow(id: string): Promise<ServiceZone> {
    const zone = await this.serviceZones.findOne({ where: { id } });
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'نطاق الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
    return zone;
  }

  /**
   * `isActive` هنا **مش زيادة**: مسار الكتابة (`isAreaLaunchedInCity`) بيشترط
   * `isLaunched && isActive` الاتنين. من غيرها القراءة والكتابة بيختلفوا — الأدمن يعطّل منطقة،
   * تفضل ظاهرة للعميل في القايمة، والعميل يختارها والسيرفر يرفض العنوان. (نفس التدقيق، §148.)
   */
  findLaunchedAreas(cityId: string): Promise<Area[]> {
    return this.areas.find({ where: { cityId, isLaunched: true, isActive: true }, order: { nameAr: 'ASC' } });
  }

  async isAreaLaunched(areaId: string): Promise<boolean> {
    const area = await this.areas.findOne({ where: { id: areaId } });
    return area !== null && area.isLaunched && area.isActive;
  }

  /**
   * Script 7 Phase 6 — بَقّة حقيقية اتلقطت: `isAreaLaunched()` القديمة بتتحقق من `area_id`
   * لوحده من غير ما تتأكد إنه فعلاً تابع لـ`city_id` المبعوت جنبه. عميل ممكن يبعت `city_id`
   * لمدينة و`area_id` لمنطقة تابعة لمدينة تانية تمامًا — العنوان كان بيتسجّل عادي بـ`cityId`
   * مش متسق مع `areaId` الحقيقي، ولأن `findZoneForPoint()` بيحدد نطاق التسعير من `cityId`
   * بس (مش من `areaId`)، ده كان بيسمح للعميل يختار أي مدينة (وبالتالي أي نطاق تسعير) بغض النظر
   * عن مكانه الفعلي — خصوصًا لما المدينة معندهاش boundary مرسوم (الحالة الحالية لكل المدن).
   */
  async isAreaLaunchedInCity(areaId: string, cityId: string): Promise<boolean> {
    const area = await this.areas.findOne({ where: { id: areaId } });
    return area !== null && area.isLaunched && area.isActive && area.cityId === cityId;
  }

  /**
   * تبسيط متعمّد لمرحلة MVP: بترجع أول نطاق نشط في المدينة بدل بحث جغرافي (ST_Contains) حقيقي
   * ضد boundary المنطقة — مقبول لما المدينة عندها نطاق واحد أو اتنين بس (§0.2.5 في الماستر بلان:
   * "اطلق على حيّين فقط"). لسه مستخدمة كـ fallback في findZoneForPoint لما مفيش نطاق في المدينة
   * عنده boundary مرسوم أصلاً (زي كل المدن الحالية في بيانات الاختبار).
   */
  findZoneForCity(cityId: string): Promise<ServiceZone | null> {
    return this.serviceZones.findOne({ where: { cityId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  /**
   * بحث جغرافي حقيقي بالـ point-in-polygon — كان فجوة موثّقة، اتقفلت.
   *
   * **قرار مهم عن سلوك الـ fallback**: لو المدينة **معندهاش ولا نطاق واحد** عنده `boundary`
   * مرسوم لسه (الحالة الافتراضية — كل نطاق بيتنشئ من غير مضلّع)، بنرجع لـ `findZoneForCity`
   * القديمة (أول نطاق نشط) عشان مانكسرش إنشاء الطلبات في كل المدن الحالية اللي لسه معندهاش
   * مضلّعات. **لكن لو المدينة عندها نطاق واحد على الأقل عنده مضلّع**، بقى ده معناه المدينة دي
   * "فعّلت" التغطية الدقيقة، فأي إحداثية برّه كل المضلّعات المرسومة بترجع `null` فعلاً (رفض حقيقي
   * "الخدمة غير متاحة") — مش fallback عشوائي لأول نطاق، لأن ده كان هيلغي فايدة الميزة كلها.
   */
  async findZoneForPoint(cityId: string, latitude: number, longitude: number): Promise<ServiceZone | null> {
    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count FROM service_zones
       WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL AND boundary IS NOT NULL`,
      [cityId],
    );
    const cityHasAnyBoundary = Number(count) > 0;
    if (!cityHasAnyBoundary) {
      // **الرجوع ده بقى مسموع بدل ما يكون صامت** (بلاغ المالك ١٠ في §141: «غيّرت العنوان
      // لمنطقة سعرها أعلى والسعر مااتغيّرش»).
      //
      // السبب مش بَقّة في التسعير — التسعير شغّال. السبب إن النطاق **بلا مضلّع مرسوم مستحيل
      // يتطابق مع عنوان**، فكل عناوين المدينة بترسّى على أقدم نطاق نشط وبالتالي على سعره.
      // الأدمن بيدخل يحطّ تسعير لنطاق تاني، الحفظ بينجح، والنتيجة صفر — بلا أي إشارة.
      //
      // التحذير بيتسجّل **بس لما يكون فيه أكتر من نطاق نشط**: مدينة بنطاق واحد مالهاش أي
      // غموض (كل العناوين نطاقها واحد فعلاً)، فالتحذير هناك ضوضاء. `diagnoseZoneCoverage()`
      // تحت بيعرض نفس الحالة للأدمن في اللوحة.
      const zone = await this.findZoneForCity(cityId);
      const [{ active_zones: activeZones }] = await this.dataSource.query<{ active_zones: number }[]>(
        `SELECT COUNT(*)::int AS active_zones FROM service_zones
         WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL`,
        [cityId],
      );
      if (Number(activeZones) > 1) {
        this.logger.warn(
          `تسعير المناطق معطّل فعليًا في المدينة ${cityId}: ${activeZones} نطاق نشط ومفيش ولا واحد ` +
            `عنده حدود مرسومة، فكل العناوين بترسّى على النطاق «${zone?.nameAr ?? '—'}» وبسعره. ` +
            `ارسم حدود النطاقات من لوحة الأدمن عشان العنوان يحدد النطاق فعلاً.`,
        );
      }
      return zone;
    }

    const rows = await this.dataSource.query<{ id: string }[]>(
      `
      SELECT id FROM service_zones
      WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL
        AND boundary IS NOT NULL
        AND ST_Contains(boundary::geometry, ST_SetSRID(ST_MakePoint($2, $3), 4326))
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [cityId, longitude, latitude],
    );

    if (rows.length === 0) return null;
    return this.serviceZones.findOne({ where: { id: rows[0].id } });
  }

  /**
   * **تشخيص تغطية النطاقات لكل مدينة** — عشان الأدمن يشوف بعينه إن تسعير المناطق شغّال ولا لأ.
   *
   * الحالة اللي بيمسكها (بلاغ المالك ١٠ في §141): مدينة فيها أكتر من نطاق نشط وسعر مختلف لكل
   * واحد، بس **مفيش حدود مرسومة** — فالعنوان مالوش أي أثر على السعر. ده أسوأ من ميزة ناقصة:
   * الأدمن ضابط تسعير وفاكره شغّال.
   *
   * مافيهوش أي رأي عن الصح والغلط: بيرجّع الأرقام والحالة، والواجهة هي اللي بتعرضها.
   */
  async diagnoseZoneCoverage(cityId?: string): Promise<
    {
      city_id: string;
      city_name_ar: string;
      active_zone_count: number;
      zones_with_boundary_count: number;
      /** `true` لما تسعير المناطق في المدينة دي مالوش أي أثر فعلي. */
      zone_pricing_inert: boolean;
    }[]
  > {
    return this.dataSource.query(
      `
      SELECT c.id AS city_id,
             c.name_ar AS city_name_ar,
             COUNT(z.id)::int AS active_zone_count,
             COUNT(z.boundary)::int AS zones_with_boundary_count,
             (COUNT(z.id) > 1 AND COUNT(z.boundary) = 0) AS zone_pricing_inert
      FROM cities c
      LEFT JOIN service_zones z
        ON z.city_id = c.id AND z.is_active = true AND z.deleted_at IS NULL
      WHERE c.is_active = true
        AND ($1::uuid IS NULL OR c.id = $1)
      GROUP BY c.id, c.name_ar
      ORDER BY (COUNT(z.id) > 1 AND COUNT(z.boundary) = 0) DESC, c.name_ar ASC
      `,
      [cityId ?? null],
    );
  }
}
