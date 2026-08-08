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

  findActiveCities(): Promise<City[]> {
    return this.cities.find({ where: { isActive: true }, order: { nameAr: 'ASC' } });
  }

  /** استخدام عام عبر الموديولات (مش بس geo) — للتحقق إن نطاق خدمة موجود قبل ربطه بحاجة تانية. */
  async findServiceZoneOrThrow(id: string): Promise<ServiceZone> {
    const zone = await this.serviceZones.findOne({ where: { id } });
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'نطاق الخدمة غير موجود', HttpStatus.NOT_FOUND);
    }
    return zone;
  }

  findLaunchedAreas(cityId: string): Promise<Area[]> {
    return this.areas.find({ where: { cityId, isLaunched: true }, order: { nameAr: 'ASC' } });
  }

  async isAreaLaunched(areaId: string): Promise<boolean> {
    const area = await this.areas.findOne({ where: { id: areaId } });
    return area !== null && area.isLaunched && area.isActive;
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
