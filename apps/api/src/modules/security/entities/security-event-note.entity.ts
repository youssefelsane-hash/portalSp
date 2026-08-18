import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مطابق لـ infra/migrations/0135_security_events.sql — ملاحظات تحقيق يدوية (Part 18)، append-only.
@Entity('security_event_notes')
export class SecurityEventNote {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'security_event_id', type: 'uuid' })
  securityEventId: string;

  @Column({ name: 'author_user_id', type: 'uuid' })
  authorUserId: string;

  @Column({ type: 'text' })
  note: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
