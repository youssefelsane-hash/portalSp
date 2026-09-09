import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { returningRows } from '../../common/db/returning-rows';
import { Order } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { MatchingDispatchQueueClient } from './matching-dispatch-queue.client';

const RECOVERY_INTERVAL_SECONDS_FALLBACK = 60;
const RECOVERY_BATCH_SIZE_FALLBACK = 25;
const RECOVERY_INITIAL_BACKOFF_SECONDS_FALLBACK = 60;
const RECOVERY_MAX_BACKOFF_SECONDS_FALLBACK = 3_600;
const MIN_RECOVERY_INTERVAL_SECONDS = 5;
const MAX_RECOVERY_INTERVAL_SECONDS = 86_400;
const MAX_RECOVERY_BATCH_SIZE = 1_000;

@Injectable()
export class MatchingRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingRecoveryService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly dispatchQueue: MatchingDispatchQueueClient,
    private readonly settingsService: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.scheduleNextSweep();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(Math.floor(value), max));
  }

  private async scheduleNextSweep(): Promise<void> {
    if (this.destroyed) return;
    let intervalSeconds = RECOVERY_INTERVAL_SECONDS_FALLBACK;
    try {
      intervalSeconds = this.clamp(
        await this.settingsService.getNumber('matching.recovery_interval_seconds', RECOVERY_INTERVAL_SECONDS_FALLBACK),
        MIN_RECOVERY_INTERVAL_SECONDS,
        MAX_RECOVERY_INTERVAL_SECONDS,
      );
    } catch (error) {
      this.logger.error('فشل قراءة زمن استرداد المطابقة؛ تم استخدام القيمة الآمنة', error instanceof Error ? error.stack : error);
    }

    // الـcallback بيفضل متزامن ويرجّع void، والدورة نفسها في دالة مستقلة — كده الرفض
    // متعامَل معاه جوّه الدالة صراحة، ومفيش Promise بيتسرّب لمكان بيتوقّع void.
    this.timer = setTimeout(() => void this.runSweepCycle(), intervalSeconds * 1_000);
    this.timer.unref?.();
  }

  /** دورة sweep واحدة + إعادة جدولة اللي بعدها — بتمسك كل استثناء بنفسها. */
  private async runSweepCycle(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error('فشل reconciliation توزيع الطلبات', error instanceof Error ? error.stack : error);
    } finally {
      await this.scheduleNextSweep();
    }
  }

  /**
   * **تبسيط جوهري (ADR-0018)** فوق منطق قريب/بعيد/lead_hours القديم (ADR-0017 بند 7-8) — بعد
   * التصحيح، كل طلب `searching_technician` (طوارئ أو مجدول) بيتوجّه لمساره الصح فورًا وقت الإنشاء
   * (`OrderDispatchListener`)، بلا أي آلية تأجيل/انتظار خالص. مهمة الـsweep دلوقتي بسيطة: أي طلب
   * لسه من غير فني (مفيش عرض حي `sent`/`viewed` قايم عليه دلوقتي) — سواء طوارئ عالقة (كل الفنيين
   * رفضوا/الجولة انتهت) أو مجدول فشل `autoConfirmScheduledOrder` الأول يلاقي فني مؤهل — لازم
   * يترشّح لإعادة المحاولة. `dispatchOrAutoConfirm()` بتفرّق طوارئ/مجدول داخليًا زي ما هي دايمًا.
   */
  async sweep(limit?: number): Promise<number> {
    const configuredBatchSize = limit ?? await this.settingsService.getNumber(
      'matching.recovery_batch_size',
      RECOVERY_BATCH_SIZE_FALLBACK,
    );
    const batchSize = this.clamp(configuredBatchSize, 1, MAX_RECOVERY_BATCH_SIZE);
    const configuredInitialBackoff = await this.settingsService.getNumber(
      'matching.recovery_initial_backoff_seconds',
      RECOVERY_INITIAL_BACKOFF_SECONDS_FALLBACK,
    );
    const initialBackoffSeconds = this.clamp(configuredInitialBackoff, 5, 86_400);
    const configuredMaxBackoff = await this.settingsService.getNumber(
      'matching.recovery_max_backoff_seconds',
      RECOVERY_MAX_BACKOFF_SECONDS_FALLBACK,
    );
    const maxBackoffSeconds = this.clamp(configuredMaxBackoff, initialBackoffSeconds, 7 * 86_400);

    // Claim + postpone happen in one transaction. Concurrent API instances cannot recover the
    // same order, and a permanently stalled old order leaves the front of the queue immediately.
    // **بَقّة حقيقية اتقاست في تدقيق ج-٤ (2026-09-09)**: النتيجة هنا كانت بتتقرا مباشرةً كأنها
    // مصفوفة صفوف، وTypeORM بترجّع `UPDATE … RETURNING` كـ`[rows, affectedCount]`. النتيجة إن
    // الحلقة تحت كانت بتلف على **عنصرين** (مصفوفة الصفوف، والرقم)، والاتنين `.id` بتاعهم
    // `undefined` — يعني `enqueueDispatch(undefined)` مرتين، والـ`jobId` بقى `dispatch-undefined`
    // فBullMQ بيدمجهم في وظيفة واحدة، والوظيفة دي بتنادي `dispatchOrAutoConfirm(undefined)` اللي
    // بترجّع فورًا بلا أي أثر. **الـsweep فضلت شغّالة شكليًا وهي فعليًا ما أعادت توزيع ولا طلب
    // واحد**: بتزوّد `matching_attempt_count` وبتأجّل `next_matching_attempt_at` (فالأدمن بيشوف
    // «٤ محاولات» ويفتكرها بتحاول)، والطلب اللي فشل توزيعه أول مرة بيفضل `searching_technician`
    // للأبد لحد ما أدمن يتدخّل بإيده. `returningRows()` هو المصدر الواحد لفك الشكل ده.
    const raw = await this.orders.manager.transaction((manager) => manager.query(
      `WITH due_orders AS (
         SELECT orders.id
         FROM orders
         WHERE orders.order_status = 'searching_technician'
           AND orders.service_zone_id IS NOT NULL
           AND orders.deleted_at IS NULL
           AND COALESCE(orders.next_matching_attempt_at, orders.placed_at, orders.created_at) <= now()
           AND NOT EXISTS (
             SELECT 1
             FROM order_assignments assignment
             WHERE assignment.order_id = orders.id
               AND assignment.assignment_status IN ('sent', 'viewed')
               AND assignment.expires_at > now()
           )
         ORDER BY COALESCE(orders.next_matching_attempt_at, orders.placed_at, orders.created_at),
                  orders.placed_at NULLS LAST,
                  orders.id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE orders
       SET last_matching_attempt_at = now(),
           matching_attempt_count = orders.matching_attempt_count + 1,
           next_matching_attempt_at = now() + make_interval(secs => LEAST(
             $3::double precision,
             $2::double precision * power(2::double precision, LEAST(orders.matching_attempt_count, 10)::double precision)
           ))
       FROM due_orders
       WHERE orders.id = due_orders.id
       RETURNING orders.id`,
      [batchSize, initialBackoffSeconds, maxBackoffSeconds],
    ));
    const rows = returningRows<{ id: string }>(raw);

    // **الـsweep بتجدول، مش بتنفّذ.**
    //
    // اللي كان هنا: `await dispatchOrAutoConfirm(row.id)` لكل صف، **واحد ورا التاني في نفس
    // العملية**. كل نداء بياخد اتصال قاعدة ويشغّل استعلام المطابقة التقيل، فدفعة ٢٥ طلب عالق
    // كانت بتستحوذ على اتصالات الـpool لحوالي ١٠ ثواني متواصلة كل دورة — وفي الوقت ده **عملاء
    // حقيقيين بياخدوا 503** (القياس والدليل في `matching-dispatch-queue.client.ts`).
    //
    // المفارقة اللي بتخلي ده خطير: كل ما الطلبات العالقة تزيد، كل ما الـsweep تتقل، كل ما
    // العملاء الجداد يترفضوا أكتر — فيعلقوا هما كمان. حلقة تدهور بتبدأ من مشكلة عرض عادية.
    //
    // دلوقتي الـsweep بتحجز وظيفة لكل طلب والـworker بيصرّفها بسقف تزامن ثابت مشترك مع الحجوزات
    // الجديدة. لو الحجز فشل (Redis واقع) **مابننفّذش مباشرة عمدًا**: صف الطلب اتأجّل بالفعل
    // بـ`next_matching_attempt_at` فوق، يعني الدورة الجاية هتحاول تاني — الطلب مش ضايع، والـpool
    // مش متستنزف.
    let scheduled = 0;
    for (const row of rows) {
      if (await this.dispatchQueue.enqueueDispatch(row.id)) scheduled += 1;
    }
    if (scheduled < rows.length) {
      this.logger.warn(`اتجدول ${scheduled} من ${rows.length} طلب عالق — الباقي هيتحاول في الدورة الجاية.`);
    }
    return scheduled;
  }
}
