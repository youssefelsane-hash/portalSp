import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0136_employee_daily_activity.sql — صف واحد لكل (موظف، يوم)، مش صف
// لكل heartbeat. القرار الكامل في docs/adr/0016-security-events-and-employee-activity.md §3.
@Entity('employee_daily_activity')
export class EmployeeDailyActivity {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'activity_date', type: 'date' })
  activityDate: string;

  @Column({ name: 'first_login_at', type: 'timestamptz', nullable: true })
  firstLoginAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt: Date | null;

  @Column({ name: 'last_logout_at', type: 'timestamptz', nullable: true })
  lastLogoutAt: Date | null;

  @Column({ name: 'active_seconds', type: 'int', default: 0 })
  activeSeconds: number;

  @Column({ name: 'sessions_count', type: 'int', default: 0 })
  sessionsCount: number;

  @Column({ name: 'actions_count', type: 'int', default: 0 })
  actionsCount: number;

  @Column({ name: 'denied_sensitive_count', type: 'int', default: 0 })
  deniedSensitiveCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
