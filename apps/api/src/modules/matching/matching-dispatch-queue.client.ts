import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MATCHING_ROUNDS_QUEUE,
  ORDER_DISPATCH_JOB,
  OrderDispatchJobData,
  orderDispatchJobId,
} from './matching-rounds.queue';

/** مهلة قصيرة على `queue.add()` نفسها — الدرس المكلف: `add()` علّق طلب حقيقي دقايق وقت انقطاع Redis. */
const ENQUEUE_TIMEOUT_MS = 2_000;

/**
 * **نقطة الدخول الوحيدة لجدولة توزيع طلب.**
 *
 * الاتنين اللي بيولّدوا شغل توزيع — إنشاء طلب جديد (`OrderDispatchListener`) واسترداد الطلبات
 * العالقة (`MatchingRecoveryService`) — بيعدّوا من هنا، فبيتشاركوا **سقف تزامن واحد** عند الـ
 * worker. من غير التوحيد ده كل مصدر بياخد من نفس الـpool بلا حساب للتاني، وده بالظبط اللي كان
 * بيحصل: الـsweep بيسحب دفعة ٢٥ طلب عالق وينفّذها **واحدة ورا التانية جوّه نفس العملية**،
 * فبيستهلك اتصالات القاعدة لحوالي ١٠ ثواني متواصلة، وفي الوقت ده **عميل حقيقي بيحاول يحجز
 * بياخد 503**.
 *
 * القياس اللي كشفه (`scripts/concurrency-booking-safety.js --concurrency 40`، خمس تشغيلات):
 * تشغيلتين من كل خمسة كانوا بيفشلوا بالكامل — واللي فشلوا كلهم زمنهم ~١٠.٥ ثانية بالظبط (مهلة
 * الحصول على اتصال)، والعيّنات من `pg_stat_activity` وقت الفشل بتقول:
 *
 *     n=22  act=1  iit=18  waits=Client/ClientRead
 *
 * تمنتاشر ترانزاكشن مفتوحة والقاعدة مستنية التطبيق يبعت — يعني الاتصالات محجوزة في شغل خلفي،
 * مش في بطء استعلامات. التناوب (نجاح/فشل) كان بيطابق دورة الـsweep (كل ٦٠ ثانية) بالظبط.
 */
@Injectable()
export class MatchingDispatchQueueClient {
  private readonly logger = new Logger(MatchingDispatchQueueClient.name);

  constructor(@InjectQueue(MATCHING_ROUNDS_QUEUE) private readonly queue: Queue<OrderDispatchJobData>) {}

  /**
   * بيرجّع `true` لو الوظيفة اتحجزت فعلاً في الطابور. أي فشل = `false`، والكولر هو اللي بيقرر
   * إيه البديل (تنفيذ مباشر، أو إهمال والاعتماد على الـsweep الجاية) — القرار ده مختلف بين
   * المصدرين، فمابيتاخدش هنا.
   *
   * `jobId` ثابت لكل طلب، فلو الطلب اتجدول من مسارين في نفس الوقت (إنشاء + استرداد) BullMQ
   * بيرفض التكرار بدل ما يوزّعه مرتين.
   */
  async enqueueDispatch(orderId: string): Promise<boolean> {
    // **حارس ضد فشل صامت** (تدقيق ج-٤): `orderId` فاضي معناه إن الكولر قرا شكل نتيجة استعلام
    // غلط. من غير الحارس ده الوظيفة بتتحجز بـ`jobId = 'dispatch-undefined'`، بتتنفّذ، وبترجّع
    // «نجحت» — وده اللي خلّى بَقّة الـsweep تعيش شهور بلا أي أثر ظاهر.
    if (!orderId) {
      this.logger.error('محاولة حجز وظيفة توزيع بلا معرّف طلب — الكولر بيقرا نتيجة الاستعلام غلط');
      return false;
    }
    try {
      await Promise.race([
        this.queue.add(
          ORDER_DISPATCH_JOB,
          { orderId },
          {
            jobId: orderDispatchJobId(orderId),
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
          },
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة حجز وظيفة التوزيع')), ENQUEUE_TIMEOUT_MS)),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(`تعذّر حجز وظيفة توزيع للطلب ${orderId}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
