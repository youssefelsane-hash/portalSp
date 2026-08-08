import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AdminGeoController } from './admin-geo.controller';
import { AdminGeoService } from './admin-geo.service';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { Area } from './entities/area.entity';
import { City } from './entities/city.entity';
import { Country } from './entities/country.entity';
import { ServiceZone } from './entities/service-zone.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Country, City, Area, ServiceZone]), AuditModule],
  controllers: [GeoController, AdminGeoController],
  providers: [GeoService, AdminGeoService],
  exports: [GeoService],
})
export class GeoModule {}
