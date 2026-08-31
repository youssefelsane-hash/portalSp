import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
import { MatchingService } from './matching.service';

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
    private readonly matchingService: MatchingService,
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

    this.timer = setTimeout(async () => {
      try {
        await this.sweep();
      } catch (error) {
        this.logger.error('فشل reconciliation توزيع الطلبات', error instanceof Error ? error.stack : error);
      } finally {
        await this.scheduleNextSweep();
      }
    }, intervalSeconds * 1_000);
    this.timer.unref?.();
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
    const rows = await this.orders.manager.transaction((manager) => manager.query<Array<{ id: string }>>(
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

    let processed = 0;
    for (const row of rows) {
      try {
        await this.matchingService.dispatchOrAutoConfirm(row.id);
        processed += 1;
      } catch (error) {
        this.logger.error(`فشل استرداد توزيع الطلب ${row.id}`, error instanceof Error ? error.stack : error);
      }
    }
    return processed;
  }
}
