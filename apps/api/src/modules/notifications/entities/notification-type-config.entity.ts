import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// إعداد أولوية/صوت/قناة/actionable لكل notification_type — صفر hardcode (ADR-0012).
export enum NotificationPriorityTier {
  CRITICAL_OFFER = 'critical_offer',
  ACTION_REQUIRED = 'action_required',
  SCHEDULED_JOB = 'scheduled_job',
  INFORMATIONAL = 'informational',
}

@Entity('notification_type_configs')
export class NotificationTypeConfig {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'notification_type', type: 'varchar', length: 60, unique: true })
  notificationType: string;

  // varchar + CHECK constraint في الـDB مش Postgres enum حقيقي (نفس نمط order_assistant_offers.offer_status)
  @Column({ name: 'priority_tier', type: 'varchar', length: 20, default: NotificationPriorityTier.INFORMATIONAL })
  priorityTier: NotificationPriorityTier;

  @Column({ name: 'default_channels', type: 'jsonb', default: () => `'["push","in_app"]'` })
  defaultChannels: string[];

  @Column({ name: 'sound_key', type: 'varchar', length: 60, nullable: true })
  soundKey: string | null;

  @Column({ name: 'is_actionable', type: 'boolean', default: false })
  isActionable: boolean;

  @Column({ name: 'action_labels', type: 'jsonb', nullable: true })
  actionLabels: Record<string, string> | null;

  @Column({ name: 'requires_acknowledgment', type: 'boolean', default: false })
  requiresAcknowledgment: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
