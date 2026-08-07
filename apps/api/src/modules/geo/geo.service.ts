import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';

@Injectable()
export class GeoService {
  constructor(
    @InjectRepository(City) private readonly cities: Repository<City>,
    @InjectRepository(Area) private readonly areas: Repository<Area>,
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
}
