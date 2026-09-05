import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مطابق لـ infra/migrations/0011_system.sql. الـ`REVOKE UPDATE, DELETE ... FROM PUBLIC` اللي هناك
// **ماكانش بيحمي فعليًا**: التطبيق بيتصل بدور مالك الجداول، والمالك مابيتأثرش بالـREVOKE. الحماية
// الحقيقية دلوقتي تريجر (migration 0271) بيرفض UPDATE/DELETE/TRUNCATE مهما كان الدور — ومخرجه
// الوحيد `app.audit_purge` مقصور على أدوات الاختبار ومحروس بـ`audit-logs-immutability.spec.ts`.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 40, nullable: true })
  actorRole: string | null;

  @Column({ name: 'actor_ip', type: 'inet', nullable: true })
  actorIp: string | null;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 60 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'old_values', type: 'jsonb', nullable: true })
  oldValues: Record<string, unknown> | null;

  @Column({ name: 'new_values', type: 'jsonb', nullable: true })
  newValues: Record<string, unknown> | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 60, nullable: true })
  requestId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
