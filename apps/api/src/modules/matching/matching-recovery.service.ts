import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { MatchingService } from './matching.service';

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

@Injectable()
export class MatchingRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly matchingService: MatchingService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((error) =>
        this.logger.error('فشل reconciliation توزيع الطلبات', error instanceof Error ? error.stack : error),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * **تبسيط جوهري (ADR-0018)** فوق منطق قريب/بعيد/lead_hours القديم (ADR-0017 بند 7-8) — بعد
   * التصحيح، كل طلب `searching_technician` (طوارئ أو مجدول) بيتوجّه لمساره الصح فورًا وقت الإنشاء
   * (`OrderDispatchListener`)، بلا أي آلية تأجيل/انتظار خالص. مهمة الـsweep دلوقتي بسيطة: أي طلب
   * لسه من غير فني (مفيش عرض حي `sent`/`viewed` قايم عليه دلوقتي) — سواء طوارئ عالقة (كل الفنيين
   * رفضوا/الجولة انتهت) أو مجدول فشل `autoConfirmScheduledOrder` الأول يلاقي فني مؤهل — لازم
   * يترشّح لإعادة المحاولة. `dispatchOrAutoConfirm()` بتفرّق طوارئ/مجدول داخليًا زي ما هي دايمًا.
   */
  async sweep(limit = BATCH_SIZE): Promise<number> {
    const rows = await this.orders.query<Array<{ id: string }>>(
      `SELECT orders.id
       FROM orders
       WHERE orders.order_status = 'searching_technician'
         AND orders.service_zone_id IS NOT NULL
         AND orders.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM order_assignments assignment
           WHERE assignment.order_id = orders.id
             AND assignment.assignment_status IN ('sent', 'viewed')
             AND assignment.expires_at > now()
         )
       ORDER BY orders.placed_at NULLS LAST, orders.id
       LIMIT $1`,
      [Math.max(1, Math.min(limit, BATCH_SIZE))],
    );

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

