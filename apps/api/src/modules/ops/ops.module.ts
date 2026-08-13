import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { MATCHING_ROUNDS_QUEUE } from '../matching/matching-rounds.queue';
import { MATCHING_DISPATCH_QUEUE } from '../matching/matching-dispatch.queue';
import { CUSTOMER_STATS_QUEUE } from '../customers/customer-stats.queue';
import { TECHNICIAN_STATS_QUEUE } from '../technicians/technician-stats.queue';
import { QueueWatchdogService } from './queue-watchdog.service';

// راقب/استرجاع تعليق الطوابير (BullMQ) — تفاصيل كاملة في queue-watchdog.service.ts.
// BullModule.registerQueue() هنا آمن يتكرر (نفس الاسم بالظبط زي MatchingModule/CustomersModule/
// TechniciansModule) — @nestjs/bullmq بيرجع نفس instance الـQueue المسجّلة قبل كده، مش يعمل
// اتصال جديد (راجع تعليق app.module.ts للتفاصيل الكاملة).
@Module({
  imports: [
    BullModule.registerQueue(
      { name: MATCHING_ROUNDS_QUEUE },
      { name: MATCHING_DISPATCH_QUEUE },
      { name: CUSTOMER_STATS_QUEUE },
      { name: TECHNICIAN_STATS_QUEUE },
    ),
    SettingsModule,
  ],
  providers: [QueueWatchdogService],
})
export class OpsModule {}
