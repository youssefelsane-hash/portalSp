import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { BookingFunnelEvent } from './entities/booking-funnel-event.entity';
import { MarketingSpend } from './entities/marketing-spend.entity';
import { ExecutiveKpisService } from './executive-kpis.service';
import { FunnelService } from './funnel.service';
import { FunnelTrackerService } from './funnel-tracker.service';
import { MarketingSpendService } from './marketing-spend.service';

/**
 * موديول التحليلات (ADR-0081).
 *
 * **الاتجاه في اتجاه واحد بس**: الموديول ده بيقرا من جداول التشغيل بـSQL، ومابيستوردش
 * `orders`/`payments`/`matching` ولا بيتم استيراده منهم — غير `FunnelTrackerService` اللي
 * بيتصدّر عشان `orders` تنده عليه لتسجيل المراحل. نفس عزل `campaigns` بالظبط، ولنفس السبب:
 * إحصائية ما تقدرش تعطّل حجز.
 *
 * `SettingsModule` مستورد عشان الاستغلال يقرا **نفس** إعداد القدرة اليومية اللي محرك المطابقة
 * بيستخدمه (`matching.daily_capacity_minutes`) — مش رقم تاني مكتوب في التحليلات.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BookingFunnelEvent, MarketingSpend]), SettingsModule, AuditModule],
  controllers: [AdminAnalyticsController],
  providers: [FunnelService, FunnelTrackerService, ExecutiveKpisService, MarketingSpendService],
  exports: [FunnelTrackerService],
})
export class AnalyticsModule {}
