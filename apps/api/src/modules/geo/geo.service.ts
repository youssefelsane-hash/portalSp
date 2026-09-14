import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { ServiceZone } from './entities/service-zone.entity';

@Injectable()
export class GeoService {
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
      return this.findZoneForCity(cityId);
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
}
