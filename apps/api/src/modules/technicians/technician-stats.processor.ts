import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { RECALCULATE_STATS_JOB, RecalculateStatsJobData, TECHNICIAN_STATS_QUEUE } from './technician-stats.queue';

/**
 * بيعيد حساب الأعمدة المحسوبة على technician_profiles من مصدر الحقيقة الفعلي (orders, ratings)
 * بدل ما يزوّد/يقلّل رقم متخزّن — أبطأ شوية بس صحيح دايماً حتى لو حصل تعارض/سباق أو خطأ سابق
 * في التحديث. الاستعلامات بتستخدم raw SQL (مش TypeORM entities) عشان الموديول ده منفصل عن
 * orders/ratings ومحتاجش يعتمد عليهم كموديولات كاملة عشان استعلام قراءة بسيط.
 */
// skipStalledCheck: true — نفس سبب matching-round-expiry.processor.ts بالظبط (enableOfflineQueue:false
// في AppModule بيخلي فحص الـ stalled jobs الدوري يرمي أخطاء غير ملتقطة وقت انقطاع Redis). آمن
// نعطّله هنا لأن الجوب idempotent بالكامل (بيعيد حساب من الأصل، مش increment) — أي محاولة تالية
// (تقييم جديد، طلب اكتمل) هتصحح أي رقم فات، مفيش خطورة من job "عالق".
@Processor(TECHNICIAN_STATS_QUEUE, { skipStalledCheck: true })
export class TechnicianStatsProcessor extends WorkerHost {
  private readonly logger = new Logger(TechnicianStatsProcessor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<RecalculateStatsJobData>): Promise<void> {
    const { technicianProfileId } = job.data;

    const [{ completed_orders_count: completedOrdersCount }] = await this.dataSource.query<
      { completed_orders_count: string }[]
    >(`SELECT COUNT(*) AS completed_orders_count FROM orders WHERE technician_id = $1 AND order_status = 'completed'`, [
      technicianProfileId,
    ]);

    const [{ average_rating: averageRating, total_ratings_count: totalRatingsCount }] = await this.dataSource.query<
      { average_rating: string | null; total_ratings_count: string }[]
    >(
      `SELECT COALESCE(AVG(r.overall_rating), 0) AS average_rating, COUNT(*) AS total_ratings_count
       FROM ratings r
       JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
       WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true`,
      [technicianProfileId],
    );

    const result = await this.dataSource.query(
      `UPDATE technician_profiles
       SET completed_orders_count = $2, average_rating = $3, total_ratings_count = $4
       WHERE id = $1`,
      [technicianProfileId, Number(completedOrdersCount), Number(averageRating), Number(totalRatingsCount)],
    );

    this.logger.log(
      `إحصائيات الفني ${technicianProfileId} اتحدّثت: completed=${completedOrdersCount}, avg_rating=${Number(averageRating).toFixed(2)}, ratings=${totalRatingsCount}`,
    );
    void result;
  }
}
