import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminPricingController } from './admin-pricing.controller';
import { CommissionBaseService } from './commission-base.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule } from './entities/service-pricing-rule.entity';
import { ServicePricingRuleTest } from './entities/service-pricing-rule-test.entity';
import { PricingController } from './pricing.controller';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingRuleTestsService } from './pricing-rule-tests.service';

// محرك التسعير الديناميكي (docs/08 §1، ADR-0001) — موديول مستقل عمدًا (راجع §14 في docs/08):
// catalog/orders بينادوا على PricingEngineService المصدّرة هنا، مش بيحسبوا هم عشان OrdersService
// ميكبرش أكتر من اللازم مع كل ميزة جديدة.
@Module({
  imports: [
    TypeOrmModule.forFeature([ServicePricingField, ServicePricingRule, ServicePricingEvaluation, ServicePricingRuleTest]),
    AuditModule,
    // ADR-0037 — سياسة وعاء العمولة بتتقرا من محرك الإعدادات، مش من كود ثابت.
    SettingsModule,
  ],
  controllers: [PricingController, AdminPricingController],
  providers: [PricingFieldsService, PricingRulesService, PricingEngineService, PricingRuleTestsService, CommissionBaseService],
  exports: [PricingEngineService, PricingFieldsService, PricingRulesService, CommissionBaseService],
})
export class PricingModule {}
