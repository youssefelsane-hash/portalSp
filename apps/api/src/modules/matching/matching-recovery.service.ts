import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { SettingsService } from '../settings/settings.service';
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
    private readonly settingsService: SettingsService,
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

  async sweep(limit = BATCH_SIZE): Promise<number> {
    const deferredLeadHours = await this.settingsService.getNumber('matching.deferred_dispatch_lead_hours', 4);
    const rows = await this.orders.query<Array<{ id: string }>>(
      `SELECT orders.id
       FROM orders
       WHERE orders.order_status = 'searching_technician'
         AND orders.service_zone_id IS NOT NULL
         AND orders.deleted_at IS NULL
         AND (orders.scheduled_at IS NULL OR orders.scheduled_at <= now() + ($2::numeric * interval '1 hour'))
         AND NOT EXISTS (
           SELECT 1
           FROM order_assignments assignment
           WHERE assignment.order_id = orders.id
             AND assignment.assignment_status IN ('sent', 'viewed')
             AND assignment.expires_at > now()
         )
       ORDER BY orders.placed_at NULLS LAST, orders.id
       LIMIT $1`,
      [Math.max(1, Math.min(limit, BATCH_SIZE)), deferredLeadHours],
    );

    let processed = 0;
    for (const row of rows) {
      try {
        await this.matchingService.dispatchNextRound(row.id);
        processed += 1;
      } catch (error) {
        this.logger.error(`فشل استرداد توزيع الطلب ${row.id}`, error instanceof Error ? error.stack : error);
      }
    }
    return processed;
  }
}

