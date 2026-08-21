import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianLevel } from './technician-profile.entity';

// مطابق بالحرف لـ infra/migrations/0028_technician_level_config.sql — قابل للتعديل بالكامل
// من admin بدون أي تعديل كود (technician_levels.manage). التفاصيل الكاملة في README.
@Entity('technician_level_config')
export class TechnicianLevelConfig {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level', unique: true })
  level: TechnicianLevel;

  @Column({ name: 'display_name_ar', type: 'varchar', length: 60 })
  displayNameAr: string;

  @Column({ name: 'commission_adjustment_percentage', type: 'numeric', precision: 5, scale: 2, default: 0 })
  commissionAdjustmentPercentage: string;

  @Column({ name: 'order_priority_weight', type: 'smallint', default: 0 })
  orderPriorityWeight: number;

  @Column({ name: 'decision_limit_cents', type: 'integer', nullable: true })
  decisionLimitCents: number | null;

  @Column({ name: 'can_lead_team', type: 'boolean', default: false })
  canLeadTeam: boolean;

  // منفصل عمداً عن can_lead_team (إنشاء/امتلاك شركة) — أهلية قيادة مهمة "اعتماد" واحدة (docs/08 §38).
  @Column({ name: 'eligible_for_team_booking', type: 'boolean', default: false })
  eligibleForTeamBooking: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
