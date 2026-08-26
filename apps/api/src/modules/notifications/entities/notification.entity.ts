import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مطابق بالحرف لـ infra/migrations/0002_enums.sql (notification_channel / notification_delivery_status)
export enum NotificationChannel {
  PUSH = 'push',
  SMS = 'sms',
  EMAIL = 'email',
  IN_APP = 'in_app',
  WHATSAPP = 'whatsapp',
}

export enum NotificationDeliveryStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  READ = 'read',
}

@Entity('notifications')
export class Notification {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'notification_type', type: 'varchar', length: 60 })
  notificationType: string;

  @Column({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
  channel: NotificationChannel;

  @Column({ name: 'title_ar', type: 'varchar', length: 160 })
  titleAr: string;

  @Column({ name: 'body_ar', type: 'text' })
  bodyAr: string;

  @Column({ name: 'deep_link', type: 'varchar', length: 255, nullable: true })
  deepLink: string | null;

  @Column({ name: 'reference_type', type: 'varchar', length: 40, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  // بيربط صف التسليم ده بالـNotificationWorkflow اللي ولّده (ADR-0012) — null لأي إشعار informational
  // عادي مالوش state machine خالص.
  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId: string | null;

  @Column({ name: 'source_outbox_id', type: 'uuid', nullable: true })
  sourceOutboxId: string | null;

  @Column({
    name: 'delivery_status',
    type: 'enum',
    enum: NotificationDeliveryStatus,
    enumName: 'notification_delivery_status',
    default: NotificationDeliveryStatus.QUEUED,
  })
  deliveryStatus: NotificationDeliveryStatus;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
