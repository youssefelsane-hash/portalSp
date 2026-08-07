import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { ServiceZone } from './entities/service-zone.entity';

@Injectable()
export class GeoService {
  constructor(
    @InjectRepository(City) private readonly cities: Repository<City>,
    @InjectRepository(Area) private readonly areas: Repository<Area>,
    @InjectRepository(ServiceZone) private readonly serviceZones: Repository<ServiceZone>,
  ) {}

  findActiveCities(): Promise<City[]> {
    return this.cities.find({ where: { isActive: true }, order: { nameAr: 'ASC' } });
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
   * "اطلق على حيّين فقط"). لازم يتحول لـ point-in-polygon حقيقي قبل ما نضيف نطاقات أكتر.
   */
  findZoneForCity(cityId: string): Promise<ServiceZone | null> {
    return this.serviceZones.findOne({ where: { cityId, isActive: true }, order: { createdAt: 'ASC' } });
  }
}
