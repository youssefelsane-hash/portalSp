import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { NotificationChannel } from './notification.entity';

// مطابق بالحرف لـ infra/migrations/0030_notification_routing.sql — توجيه إشعارات داخلية
// (شكوى جديدة، صرف محتاج مراجعة، ...) لكل أدمن عنده دور معيّن، قابل للتعديل بالكامل من admin.
@Entity('notification_routing_rules')
export class NotificationRoutingRule {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType: string;

  @Column({ name: 'role_name', type: 'varchar', length: 60 })
  roleName: string;

  @Column({ type: 'jsonb', default: () => `'["in_app"]'` })
  channels: NotificationChannel[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
