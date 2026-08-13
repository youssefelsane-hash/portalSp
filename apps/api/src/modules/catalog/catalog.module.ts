import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { TechniciansModule } from '../technicians/technicians.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { OrderCompletedProductivityCaptureListener } from './order-completed-productivity-capture.listener';
import { ProductivityLearningService } from './productivity-learning.service';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceProductivityActual } from './entities/service-productivity-actual.entity';
import { ServiceProductivitySuggestion } from './entities/service-productivity-suggestion.entity';
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
      ServiceProductivitySuggestion,
      TechnicianService,
      // محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — نفس نمط أي استيراد كيان
      // من موديول تاني بلا استيراد دائري (زي matching.module.ts's Order): OrdersModule نفسها
      // بتستورد CatalogModule، مش العكس. Order/OrderTeamMember هنا للقراءة بس (بيانات observation).
      Order,
      OrderTeamMember,
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
  providers: [CatalogService, AdminCatalogService, ProductivityLearningService, OrderCompletedProductivityCaptureListener],
  exports: [CatalogService],
})
export class CatalogModule {}
