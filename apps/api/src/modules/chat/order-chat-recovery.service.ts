import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { ChatService } from './chat.service';

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

type RecoveryRow = {
  id: string;
  customer_id: string;
  technician_id: string;
  action: 'create' | 'schedule_close';
};

@Injectable()
export class OrderChatRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderChatRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly chatService: ChatService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'order-chat-recovery', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(limit = BATCH_SIZE): Promise<number> {
    const rows = await this.orders.query<RecoveryRow[]>(
      `SELECT candidate.id, candidate.customer_id, candidate.technician_id, candidate.action
       FROM (
         SELECT orders.id, orders.customer_id, orders.technician_id, 'create'::text AS action,
                orders.accepted_at AS action_at
         FROM orders
         WHERE orders.order_status IN (
                 'accepted', 'technician_on_way', 'technician_arrived',
                 'in_progress', 'awaiting_quote_approval', 'work_completed', 'awaiting_payment'
               )
           AND orders.technician_id IS NOT NULL
           AND orders.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM chat_threads thread WHERE thread.order_id = orders.id)

         UNION ALL

         SELECT orders.id, orders.customer_id, orders.technician_id, 'schedule_close'::text AS action,
                orders.closed_at AS action_at
         FROM orders
         JOIN chat_threads thread ON thread.order_id = orders.id
         WHERE orders.order_status = 'completed'
           AND thread.closes_at IS NULL
       ) candidate
       ORDER BY candidate.action_at NULLS LAST, candidate.id
       LIMIT $1`,
      [Math.max(1, Math.min(limit, BATCH_SIZE))],
    );

    let processed = 0;
    for (const row of rows) {
      try {
        if (row.action === 'create') {
          await this.chatService.createThreadForOrder(row.id, row.customer_id, row.technician_id);
        } else {
          await this.chatService.scheduleCloseForOrder(row.id);
        }
        processed += 1;
      } catch (error) {
        this.logger.error(`فشل استرداد شات الطلب ${row.id}`, error instanceof Error ? error.stack : error);
      }
    }
    return processed;
  }
}

