import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceProductivityActual } from './entities/service-productivity-actual.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { TechnicianService } from './entities/technician-service.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCategory,
      Service,
      ServiceZonePricing,
      ServiceLevelPricing,
      ServiceAddon,
      ServiceStandardData,
      ServiceProductivityActual,
      TechnicianService,
    ]),
    TechniciansModule,
    AuditModule,
    SettingsModule,
    // محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — CatalogService.estimate() بينادي
    // PricingEngineService.evaluate() لخدمات pricing_model=formula. مفيش استيراد دائري:
    // PricingModule بيستورد TypeOrmModule+AuditModule بس، مش CatalogModule.
    PricingModule,
  ],
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService, AdminCatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
