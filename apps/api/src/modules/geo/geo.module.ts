import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { Country } from './entities/country.entity';
import { ServiceZone } from './entities/service-zone.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Country, City, Area, ServiceZone])],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
