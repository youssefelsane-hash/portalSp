import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { AssistantMatchingService } from './assistant-matching.service';

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

type RecoveryRow = { id: string; has_expired_offer: boolean };

@Injectable()
export class AssistantMatchingRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantMatchingRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly matching: AssistantMatchingService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'assistant-matching-recovery', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(limit = BATCH_SIZE): Promise<number> {
    const rows = await this.orders.query<RecoveryRow[]>(
      `SELECT orders.id,
              EXISTS (
                SELECT 1 FROM order_assistant_offers offer
                WHERE offer.order_id = orders.id
                  AND offer.offer_status = 'sent'
                  AND offer.expires_at <= now()
              ) AS has_expired_offer
       FROM orders
       WHERE orders.order_status IN (
               'accepted', 'technician_on_way', 'technician_arrived',
               'in_progress', 'awaiting_quote_approval'
             )
         AND orders.technician_id IS NOT NULL
         AND COALESCE(orders.required_assistants, 0) > (
           SELECT count(*) FROM order_team_members member
           WHERE member.order_id = orders.id AND member.member_type = 'assistant'
         )
         AND (
           NOT EXISTS (SELECT 1 FROM order_assistant_offers offer WHERE offer.order_id = orders.id)
           OR EXISTS (
             SELECT 1 FROM order_assistant_offers offer
             WHERE offer.order_id = orders.id
               AND offer.offer_status = 'sent'
               AND offer.expires_at <= now()
           )
         )
       ORDER BY orders.accepted_at NULLS LAST, orders.id
       LIMIT $1`,
      [Math.max(1, Math.min(limit, BATCH_SIZE))],
    );

    let processed = 0;
    for (const row of rows) {
      try {
        if (row.has_expired_offer) await this.matching.handleExpiry(row.id);
        else await this.matching.startMatching(row.id);
        processed += 1;
      } catch (error) {
        this.logger.error(`فشل استرداد مطابقة مساعدين للطلب ${row.id}`, error instanceof Error ? error.stack : error);
      }
    }
    return processed;
  }
}

