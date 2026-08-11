import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CUSTOMER_STATS_QUEUE, RECALCULATE_CUSTOMER_STATS_JOB, RecalculateCustomerStatsJobData } from './customer-stats.queue';

// نقطة الدخول الوحيدة اللي أي موديول تاني (orders, payments) بيستخدمها عشان يطلب إعادة حساب
// إحصائيات عميل — نفس فلسفة technicians/technician-stats.service.ts بالحرف: فشل الجدولة نفسه
// (Redis واقع) مبيكسرش العملية الحقيقية اللي طلبته (إنشاء طلب، اكتمال، إلغاء) — بيتسجّل في اللوج بس.
@Injectable()
export class CustomerStatsService {
  private readonly logger = new Logger(CustomerStatsService.name);

  constructor(@InjectQueue(CUSTOMER_STATS_QUEUE) private readonly statsQueue: Queue<RecalculateCustomerStatsJobData>) {}

  async enqueueRecalculation(customerProfileId: string): Promise<void> {
    try {
      await this.statsQueue.add(RECALCULATE_CUSTOMER_STATS_JOB, { customerProfileId });
    } catch (err) {
      this.logger.warn(`فشل جدولة إعادة حساب إحصائيات العميل ${customerProfileId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
