import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RECALCULATE_STATS_JOB, RecalculateStatsJobData, TECHNICIAN_STATS_QUEUE } from './technician-stats.queue';

// نقطة الدخول الوحيدة اللي أي موديول تاني (payments, ratings) بيستخدمها عشان يطلب إعادة حساب
// إحصائيات فني — مش بيلمس الأعمدة نفسها مباشرة، بيجدول job بس (§14.4). فشل الجدولة نفسه
// (Redis واقع) مبيكسرش العملية الحقيقية اللي طلبته (اكتمال طلب، تقييم) — بيتسجّل في اللوج بس.
@Injectable()
export class TechnicianStatsService {
  private readonly logger = new Logger(TechnicianStatsService.name);

  constructor(@InjectQueue(TECHNICIAN_STATS_QUEUE) private readonly statsQueue: Queue<RecalculateStatsJobData>) {}

  async enqueueRecalculation(technicianProfileId: string): Promise<void> {
    try {
      await this.statsQueue.add(RECALCULATE_STATS_JOB, { technicianProfileId });
    } catch (err) {
      this.logger.warn(`فشل جدولة إعادة حساب إحصائيات الفني ${technicianProfileId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
