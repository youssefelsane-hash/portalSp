import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { RefundResolvedEvent } from '../../common/events/refund-resolved.event';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { NotificationChannel } from './entities/notification.entity';
import { refundNotificationCopy } from './listeners/refund-notification.listener';
import { NotificationsService } from './notifications.service';

interface PaymentNotificationOutboxRow {
  id: string;
  event_type: 'refund_resolved';
  payload: RefundResolvedEvent;
  customer_profile_id: string;
  attempts: number;
}

/**
 * تسليم الأحداث المالية لا يعتمد على EventEmitter داخل الذاكرة: العملية المالية تكتب صف outbox
 * داخل معاملتها نفسها، وهذا المعالج يرسل ويعيد المحاولة دون لمس المال أو تكرار صندوق الإشعارات.
 */
@Injectable()
export class PaymentNotificationOutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentNotificationOutboxProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void runExclusiveSweep(this.dataSource, 'payment-notification-outbox', () => this.sweep(), this.logger);
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

  private async claim(limit: number): Promise<PaymentNotificationOutboxRow[]> {
    const result = await this.dataSource.transaction((manager) => manager.query(
      `WITH candidates AS (
         SELECT id FROM payment_notification_outbox
         WHERE (status='pending' AND next_attempt_at <= now())
            OR (status='processing' AND locked_at < now() - interval '5 minutes')
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE payment_notification_outbox o
       SET status='processing', attempts=attempts+1, locked_at=now(), last_error=NULL
       FROM candidates c WHERE o.id=c.id
       RETURNING o.id, o.event_type, o.payload, o.customer_profile_id, o.attempts`,
      [Math.max(1, Math.min(100, limit))],
    ));
    return (Array.isArray(result[0]) ? result[0] : result) as PaymentNotificationOutboxRow[];
  }

  private async deliver(row: PaymentNotificationOutboxRow): Promise<void> {
    try {
      if (row.event_type !== 'refund_resolved') throw new Error(`حدث مالي غير مدعوم: ${row.event_type}`);
      const event = row.payload;
      const customer = await this.customerProfiles.findByProfileIdOrThrow(row.customer_profile_id);
      const copy = refundNotificationCopy(event);
      const deliveries = await this.notifications.notifyMultiChannel({
        userId: customer.userId,
        notificationType: event.status === 'completed' ? 'refund_completed' : 'refund_rejected',
        titleAr: copy.titleAr,
        bodyAr: copy.bodyAr,
        referenceType: 'refund',
        referenceId: event.refundId,
        deepLink: `/orders/${event.orderId}`,
        sourceDeliveryKey: `payment-notification-outbox:${row.id}`,
      }, [NotificationChannel.IN_APP, NotificationChannel.PUSH]);
      const failures = deliveries.filter((delivery) => delivery.deliveryStatus === 'failed');
      if (failures.length > 0) {
        throw new Error(`فشل تسليم ${failures.map((delivery) => delivery.channel).join(', ')}`);
      }
      await this.dataSource.query(
        `UPDATE payment_notification_outbox
         SET status='delivered', delivered_at=now(), locked_at=NULL WHERE id=$1`,
        [row.id],
      );
    } catch (error) {
      const exhausted = row.attempts >= 5;
      await this.dataSource.query(
        `UPDATE payment_notification_outbox
         SET status=$2, locked_at=NULL, last_error=$3,
             next_attempt_at=now() + ($4 * interval '30 seconds')
         WHERE id=$1`,
        [row.id, exhausted ? 'manual_review' : 'pending', error instanceof Error ? error.message.slice(0, 2000) : 'unknown', row.attempts],
      );
      this.logger.error(`Payment notification outbox ${row.id} failed`, error instanceof Error ? error.stack : error);
    }
  }
}
