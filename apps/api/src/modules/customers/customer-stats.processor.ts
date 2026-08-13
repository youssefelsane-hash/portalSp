import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { getRedisUrl } from '../../config/redis-url.util';
import { CUSTOMER_STATS_QUEUE, RecalculateCustomerStatsJobData } from './customer-stats.queue';

/**
 * بيعيد حساب الأعمدة المحسوبة على customer_profiles من مصدر الحقيقة الفعلي (orders, ratings) —
 * نفس فلسفة technicians/technician-stats.processor.ts بالحرف: أبطأ شوية من زيادة/تقليل رقم
 * متخزّن، بس صحيح دايماً حتى لو حصل تعارض/سباق أو خطأ سابق في التحديث.
 */
// نفس اتصال Redis المباشر (بدل configKey) ونفس enableOfflineQueue: false — راجع التعليق الكامل
// في technician-stats.processor.ts للتفاصيل (بَقّة BullMQ #4479 موثّقة، مش قابلة للحل من كودنا).
@Processor(
  { name: CUSTOMER_STATS_QUEUE },
  {
    connection: {
      url: getRedisUrl(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    },
  },
)
export class CustomerStatsProcessor extends WorkerHost {
  private readonly logger = new Logger(CustomerStatsProcessor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  @OnWorkerEvent('error')
  handleWorkerError(error: Error): void {
    this.logger.warn(`Worker error (customer-stats): ${error.message}`);
  }

  async process(job: Job<RecalculateCustomerStatsJobData>): Promise<void> {
    const { customerProfileId } = job.data;

    const [orderStats] = await this.dataSource.query<
      {
        total_orders_count: string;
        completed_orders_count: string;
        cancelled_orders_count: string;
        total_spent_cents: string;
        first_order_at: Date | null;
        last_order_at: Date | null;
      }[]
    >(
      `SELECT
         COUNT(*) AS total_orders_count,
         COUNT(*) FILTER (WHERE order_status = 'completed') AS completed_orders_count,
         COUNT(*) FILTER (WHERE order_status IN ('cancelled_by_customer', 'cancelled_by_technician', 'cancelled_by_system')) AS cancelled_orders_count,
         COALESCE(SUM(total_amount_cents) FILTER (WHERE order_status = 'completed'), 0) AS total_spent_cents,
         MIN(created_at) AS first_order_at,
         MAX(created_at) AS last_order_at
       FROM orders
       WHERE customer_id = $1 AND deleted_at IS NULL`,
      [customerProfileId],
    );

    const [ratingStats] = await this.dataSource.query<{ average_rating_given: string | null; ratings_given_count: string }[]>(
      `SELECT AVG(r.overall_rating) AS average_rating_given, COUNT(*) AS ratings_given_count
       FROM ratings r
       JOIN customer_profiles cp ON cp.user_id = r.rated_by_user_id
       WHERE cp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true`,
      [customerProfileId],
    );

    const averageRatingGiven = Number(ratingStats.ratings_given_count) > 0 ? Number(ratingStats.average_rating_given) : null;

    await this.dataSource.query(
      `UPDATE customer_profiles
       SET total_orders_count = $2, completed_orders_count = $3, cancelled_orders_count = $4,
           total_spent_cents = $5, first_order_at = $6, last_order_at = $7, average_rating_given = $8
       WHERE id = $1`,
      [
        customerProfileId,
        Number(orderStats.total_orders_count),
        Number(orderStats.completed_orders_count),
        Number(orderStats.cancelled_orders_count),
        Number(orderStats.total_spent_cents),
        orderStats.first_order_at,
        orderStats.last_order_at,
        averageRatingGiven,
      ],
    );

    this.logger.log(
      `إحصائيات العميل ${customerProfileId} اتحدّثت: total=${orderStats.total_orders_count}, completed=${orderStats.completed_orders_count}, cancelled=${orderStats.cancelled_orders_count}, spent=${orderStats.total_spent_cents}`,
    );
  }
}
