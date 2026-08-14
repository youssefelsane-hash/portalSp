import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// state machine عام لأي إشعار "محتاج فعل"/"محتاج acknowledgment" (action_required/scheduled_job،
// ADR-0012) — منفصل عن Notification (سجل تسليم فعلي، صف لكل محاولة إرسال). التكرار مُدار بالكامل
// من الباك-إند عبر NotificationWorkflowReminderService (sweep دوري، مش BullMQ — راجع الـADR).
@Entity('notification_workflows')
export class NotificationWorkflow {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'notification_type', type: 'varchar', length: 60 })
  notificationType: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 40, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'title_ar', type: 'varchar', length: 160 })
  titleAr: string;

  @Column({ name: 'body_ar', type: 'text' })
  bodyAr: string;

  @Column({ name: 'deep_link', type: 'varchar', length: 255, nullable: true })
  deepLink: string | null;

  @Column({ name: 'requires_action', type: 'boolean', default: true })
  requiresAction: boolean;

  @Column({ name: 'action_type', type: 'varchar', length: 60, nullable: true })
  actionType: string | null;

  // أول ما المستخدم يفتح/يشوف الإشعار — مختلف عن resolved_at (الفعل المطلوب نفسه اتم فعليًا).
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'next_reminder_at', type: 'timestamptz', nullable: true })
  nextReminderAt: Date | null;

  @Column({ name: 'reminder_count', type: 'integer', default: 0 })
  reminderCount: number;

  // snapshot من الإعداد وقت الإنشاء — تغيير الإعداد بعدين ميأثرش على workflows قايمة بالفعل.
  @Column({ name: 'max_reminders', type: 'integer', nullable: true })
  maxReminders: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // الموعد المستهدف لـscheduled_job (orders.scheduled_at وقت الإنشاء) — checkpoints التذكير
  // بتتحسب بالنسبة له (scheduled-job-checkpoints.util.ts)، مش فاصل ثابت زي action_required.
  @Column({ name: 'target_at', type: 'timestamptz', nullable: true })
  targetAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
