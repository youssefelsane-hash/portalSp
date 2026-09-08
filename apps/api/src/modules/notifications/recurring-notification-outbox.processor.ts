import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { OrderStatus } from '../orders/entities/order.entity';
import { NotificationChannel } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

interface RecurringOutboxRow {
  id: string;
  event_type: 'cash_reminder';
  order_id: string;
  customer_profile_id: string;
  attempts: number;
}

const REMINDABLE_STATUSES = [
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_ADMIN_QUOTE,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
  OrderStatus.AWAITING_TECHNICIAN_SELECTION,
  OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
];

/** تسليم تذكير الكاش المتكرر مستقل وقابل للاستئناف؛ لا يكفي event داخل ذاكرة السيرفر. */
@Injectable()
export class RecurringNotificationOutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringNotificationOutboxProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customers: CustomerProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void runExclusiveSweep(this.dataSource, 'recurring-notification-outbox', () => this.sweep(), this.logger);
    }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (const row of await this.claim(50)) await this.deliver(row);
    } finally {
      this.draining = false;
    }
  }

  private async claim(limit: number): Promise<RecurringOutboxRow[]> {
    const result = await this.dataSource.transaction((manager) => manager.query(
      `WITH candidates AS (
         SELECT id FROM recurring_notification_outbox
         WHERE (status='pending' AND next_attempt_at <= now())
            OR (status='processing' AND locked_at < now() - interval '5 minutes')
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE recurring_notification_outbox o
       SET status='processing', attempts=attempts+1, locked_at=now(), last_error=NULL
       FROM candidates c WHERE o.id=c.id
       RETURNING o.id, o.event_type, o.order_id, o.customer_profile_id, o.attempts`,
      [Math.max(1, Math.min(100, limit))],
    ));
    return (Array.isArray(result[0]) ? result[0] : result) as RecurringOutboxRow[];
  }

  private async deliver(row: RecurringOutboxRow): Promise<void> {
    try {
      const [order] = await this.dataSource.query<{
        order_number: string; scheduled_at: Date; total_amount_cents: number; order_status: OrderStatus;
      }[]>(
        `SELECT order_number, scheduled_at, total_amount_cents, order_status
         FROM orders WHERE id=$1`,
        [row.order_id],
      );
      // لو الحجز اتلغى/انتهى أو اتغير لحالة لا يجوز وعد العميل فيها، نغلق الرسالة بلا إرسال.
      if (!order || !order.scheduled_at || new Date(order.scheduled_at) <= new Date() || !REMINDABLE_STATUSES.includes(order.order_status)) {
        await this.dataSource.query(
          `UPDATE recurring_notification_outbox SET status='discarded', delivered_at=now(), locked_at=NULL WHERE id=$1`,
          [row.id],
        );
        await this.dataSource.query(
          `UPDATE orders SET recurring_cash_reminder_claimed_at=NULL WHERE id=$1`,
          [row.order_id],
        );
        return;
      }
      const customer = await this.customers.findByProfileIdOrThrow(row.customer_profile_id);
      const when = new Intl.DateTimeFormat('ar-EG', {
        dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo',
      }).format(new Date(order.scheduled_at));
      const price = (Number(order.total_amount_cents) / 100).toLocaleString('ar-EG', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      const deliveries = await this.notifications.notifyMultiChannel({
        userId: customer.userId,
        notificationType: 'recurring_cash_reminder',
        titleAr: 'تذكير بحجزك المتكرر',
        bodyAr: `حجزك المتكرر موعده ${when}. قيمة الزيارة ${price} ج.م. سنرسل تفاصيل مقدم الخدمة بعد تعيينه.`,
        referenceType: 'order',
        referenceId: row.order_id,
        deepLink: `/orders/${row.order_id}`,
        sourceDeliveryKey: `recurring-notification-outbox:${row.id}`,
      }, [NotificationChannel.IN_APP, NotificationChannel.PUSH]);
      const failed = deliveries.filter((delivery) => delivery.deliveryStatus === 'failed');
      if (failed.length) throw new Error(`فشل تسليم ${failed.map((delivery) => delivery.channel).join(', ')}`);
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE recurring_notification_outbox SET status='delivered', delivered_at=now(), locked_at=NULL WHERE id=$1`,
          [row.id],
        );
        await manager.query(
          `UPDATE orders SET recurring_cash_reminder_sent_at=now(), recurring_cash_reminder_claimed_at=NULL
           WHERE id=$1 AND recurring_cash_reminder_sent_at IS NULL`,
          [row.order_id],
        );
      });
    } catch (error) {
      const exhausted = row.attempts >= 5;
      await this.dataSource.query(
        `UPDATE recurring_notification_outbox SET status=$2, locked_at=NULL, last_error=$3,
           next_attempt_at=now() + ($4 * interval '30 seconds') WHERE id=$1`,
        [row.id, exhausted ? 'manual_review' : 'pending', error instanceof Error ? error.message.slice(0, 2000) : 'unknown', row.attempts],
      );
      this.logger.error(`Recurring notification outbox ${row.id} failed`, error instanceof Error ? error.stack : error);
    }
  }
}
