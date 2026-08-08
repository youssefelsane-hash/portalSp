import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { getRedisUrl } from '../../config/redis-url.util';
import { RECALCULATE_STATS_JOB, RecalculateStatsJobData, TECHNICIAN_STATS_QUEUE } from './technician-stats.queue';

/**
 * بيعيد حساب الأعمدة المحسوبة على technician_profiles من مصدر الحقيقة الفعلي (orders, ratings)
 * بدل ما يزوّد/يقلّل رقم متخزّن — أبطأ شوية بس صحيح دايماً حتى لو حصل تعارض/سباق أو خطأ سابق
 * في التحديث. الاستعلامات بتستخدم raw SQL (مش TypeORM entities) عشان الموديول ده منفصل عن
 * orders/ratings ومحتاجش يعتمد عليهم كموديولات كاملة عشان استعلام قراءة بسيط.
 */
// اتصال Redis منفصل عن اتصال الـ Queue (producer) بتاع AppModule، ممرَّر مباشرة هنا (مش عن طريق
// configKey) — @nestjs/bullmq بيحل اتصال الـ Worker عن طريق البحث عن Queue متسجّل بنفس الاسم أولاً
// (getQueueOptions في bull.explorer.js)، ولو لقاه (وهو موجود فعلاً، متسجّل في TechniciansModule)
// بيستخدم اتصاله على طول ويتجاهل configKey تماماً — override مباشر لـ connection هنا هو الطريقة
// المضمونة الوحيدة (تفاصيل كاملة عن التحقيق في README).
//
// enableOfflineQueue: false هنا زي اتصال الـ Queue بالظبط — جُرِّب الاتنين (true وfalse) حياً في
// اختبار انقطاع Redis كامل، والفرق بينهم في نتيجة "هل الـ Worker بيرجع يعالج وظايف بعد رجوع
// Redis من غير إعادة تشغيل الـ process" كان **معدوم**: في الحالتين الاتنين، الـ Worker يفضل
// isRunning()=true (مش متوقف/معلّق ظاهرياً) لكن بيوقف عن جلب وظايف جديدة تماماً بعد أي انقطاع
// Redis يعدّي شوية، وده متطابق مع بَقّة موثّقة معروفة في BullMQ نفسه (#4479: اتصال blocking
// بيتعطل بعد إعادة اتصال ومايرجعش يشتغل صح حتى مع الـ watchdog اللي BullMQ ضايفه في v6 بالذات
// لكده). بما إن مفيش فرق فعلي، اتسابت false هنا عشان تتفق مع اتصال الـ Queue ومع سلوك fail-fast
// الموثّق أصلاً، مش لأنها بتحل المشكلة.
@Processor(
  { name: TECHNICIAN_STATS_QUEUE },
  {
    connection: {
      url: getRedisUrl(),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    },
  },
)
export class TechnicianStatsProcessor extends WorkerHost {
  private readonly logger = new Logger(TechnicianStatsProcessor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  // لازم نستمع لـ 'error' — Node's EventEmitter بيرمي الخطأ نفسه (throw) لو 'error' اتبعت
  // وماحدش مستمع ليه، وده كان بيسبب crash فعلي لـ setInterval بتاع الـ stalled-check timer
  // (شفنا stack trace خام في اللوج مش عن طريق الـ logger) وقت انقطاع Redis. دلوقتي بيتسجّل
  // نضيف بأمان بدل ما يوقع بصمت.
  @OnWorkerEvent('error')
  handleWorkerError(error: Error): void {
    this.logger.warn(`Worker error (technician-stats): ${error.message}`);
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
