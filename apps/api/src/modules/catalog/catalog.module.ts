import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ServiceCategory } from './entities/service-category.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCategory, Service, ServiceZonePricing])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
