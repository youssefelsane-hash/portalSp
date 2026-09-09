import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { returningRows } from '../../common/db/returning-rows';
import { OrderStatus } from './entities/order.entity';
import { OrderChangeSource } from './entities/order-status-history.entity';

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;

/**
 * **إنقاذ الطلبات العالقة في «مستنيك تختار الفني».**
 *
 * ## المشكلة
 *
 * `AWAITING_TECHNICIAN_SELECTION` كانت بتقول للعميل «اختار الفني عشان نكمّل»، ومفيش أي شاشة في
 * `customer-app` ولا `customer-web` بتنده `provider-candidates` ولا `select-provider` — فالطلب
 * بيقف عند رسالة بتطلب فعل مافيش زرار يعمله. الموافقة بقت بتوّدي الطلب للتوزيع التلقائي على
 * طول (`InspectionQuoteService.approveInitialQuote`)، بس ده بيصلّح **الطلبات الجديدة بس**.
 *
 * الطلبات اللي وقعت في الحالة دي قبل التغيير هتفضل واقفة للأبد — والمالك شايفها فعلاً على
 * جهازه (`ORD-2026-000301`: «awaiting_technician_selection» ومفيش أي حاجة بتحصل).
 *
 * ## الحل
 *
 * دورة بتلقط الطلبات دي وتدخّلها التوزيع بنفس نقطة الدخول الموحّدة (`ORDER_CREATED_EVENT`،
 * ADR-0018) — **مش نظام موازي**، بالظبط زي ما الموافقة بتعمل دلوقتي.
 *
 * الدورة بتفضل شغّالة عمدًا حتى بعد ما الطلبات القديمة تخلص: `PostQuoteProviderSelectionService`
 * لسه بتقدر تحط طلب في الحالة دي (مسار أدمن/عمليات)، فأي طلب بينسى فيها بيترجع للتوزيع خلال
 * دقيقة بدل ما يبقى طريق مسدود تاني.
 */
@Injectable()
export class StuckSelectionRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StuckSelectionRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الموزّع (ADR-0076): نسخة واحدة بس بتشغّل الدورة، وإلا الطلب بيتوزّع مرتين.
      void runExclusiveSweep(this.dataSource, 'stuck-selection-recovery', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(limit = BATCH_SIZE): Promise<number> {
    // التحديث والقراءة في عبارة واحدة: الطلب بيخرج من الحالة العالقة **قبل** ما نبثّه، فحتى لو
    // الدورة اتكررت مايتبعتش مرتين. `FOR UPDATE SKIP LOCKED` مش محتاجينه — الشرط نفسه بيمنع
    // التكرار لأن الحالة بتتغيّر ذرّيًا.
    const raw = await this.dataSource.query(
      `UPDATE orders
          SET order_status = $1, updated_at = now()
        WHERE id IN (
          SELECT id FROM orders
           WHERE order_status = $2 AND deleted_at IS NULL
           ORDER BY created_at
           LIMIT $3
        )
      RETURNING id, order_number, customer_id, technician_id`,
      [OrderStatus.SEARCHING_TECHNICIAN, OrderStatus.AWAITING_TECHNICIAN_SELECTION, limit],
    );
    const rows = returningRows<{
      id: string;
      order_number: string;
      customer_id: string;
      technician_id: string | null;
    }>(raw);

    if (rows.length === 0) return 0;

    for (const row of rows) {
      await this.dataSource.query(
        `INSERT INTO order_status_history (order_id, previous_status, new_status, change_source, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.id,
          OrderStatus.AWAITING_TECHNICIAN_SELECTION,
          OrderStatus.SEARCHING_TECHNICIAN,
          OrderChangeSource.SYSTEM,
          'الطلب كان واقف في حالة اختيار فني مالهاش شاشة عند العميل — اتحوّل للتوزيع التلقائي',
        ],
      );
      this.events.emit(
        ORDER_STATUS_CHANGED_EVENT,
        new OrderStatusChangedEvent(
          row.id,
          row.order_number,
          OrderStatus.AWAITING_TECHNICIAN_SELECTION,
          OrderStatus.SEARCHING_TECHNICIAN,
          row.customer_id,
          row.technician_id,
        ),
      );
      await this.events.emitAsync(ORDER_CREATED_EVENT, new OrderCreatedEvent(row.id));
    }

    this.logger.log(`إنقاذ ${rows.length} طلب كان واقف في «اختيار الفني» — اتبعتوا للتوزيع التلقائي`);
    return rows.length;
  }
}
