import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { BookingFunnelEvent } from './entities/booking-funnel-event.entity';
import { FunnelService } from './funnel.service';
import { FunnelTrackerService } from './funnel-tracker.service';

/**
 * موديول التحليلات (ADR-0075).
 *
 * **الاتجاه في اتجاه واحد بس**: الموديول ده بيقرا من جداول التشغيل بـSQL، ومابيستوردش
 * `orders`/`payments`/`matching` ولا بيتم استيراده منهم — غير `FunnelTrackerService` اللي
 * بيتصدّر عشان `orders` تنده عليه لتسجيل المراحل. نفس عزل `campaigns` بالظبط، ولنفس السبب:
 * إحصائية ما تقدرش تعطّل حجز.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BookingFunnelEvent])],
  controllers: [AdminAnalyticsController],
  providers: [FunnelService, FunnelTrackerService],
  exports: [FunnelTrackerService],
})
export class AnalyticsModule {}
