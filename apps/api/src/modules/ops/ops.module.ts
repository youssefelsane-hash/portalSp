import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { MATCHING_ROUNDS_QUEUE } from '../matching/matching-rounds.queue';
import { ASSISTANT_MATCHING_QUEUE } from '../assistant-matching/assistant-matching.queue';
import { CUSTOMER_STATS_QUEUE } from '../customers/customer-stats.queue';
import { TECHNICIAN_STATS_QUEUE } from '../technicians/technician-stats.queue';
import { QueueWatchdogService } from './queue-watchdog.service';
import { OpsMetricsService } from './ops-metrics.service';
import { AdminOpsController } from './admin-ops.controller';
import { DatabaseModule } from '../../database/database.module';
import { ObservabilityModule } from '../../common/observability/observability.module';

// راقب/استرجاع تعليق الطوابير (BullMQ) — تفاصيل كاملة في queue-watchdog.service.ts.
// BullModule.registerQueue() هنا آمن يتكرر (نفس الاسم بالظبط زي MatchingModule/CustomersModule/
// TechniciansModule) — @nestjs/bullmq بيرجع نفس instance الـQueue المسجّلة قبل كده، مش يعمل
// اتصال جديد (راجع تعليق app.module.ts للتفاصيل الكاملة).
@Module({
  imports: [
    BullModule.registerQueue(
      { name: MATCHING_ROUNDS_QUEUE },
      { name: ASSISTANT_MATCHING_QUEUE },
      { name: CUSTOMER_STATS_QUEUE },
      { name: TECHNICIAN_STATS_QUEUE },
    ),
    SettingsModule,
    // `DbPoolMonitorService` (اتصالات القاعدة) و`RequestMetricsService` (5xx والزمن) — الاتنين
    // إشارات مطلوبة في `OpsMetricsService`، وكل واحد عايش في موديوله الأصلي مش متكرر هنا.
    DatabaseModule,
    ObservabilityModule,
  ],
  controllers: [AdminOpsController],
  providers: [QueueWatchdogService, OpsMetricsService],
})
export class OpsModule {}
