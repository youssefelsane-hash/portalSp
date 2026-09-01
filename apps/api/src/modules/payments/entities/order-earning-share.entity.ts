import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق بالحرف لـ infra/migrations/0195_order_earning_shares.sql
@Entity('order_earning_shares')
export class OrderEarningShare {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'participant_role', type: 'varchar', length: 20 })
  participantRole: 'leader' | 'team_member' | 'assistant';

  // المستوى والوزن **وقت التنفيذ** — تغيير مستوى الفني بعدين ما يغيّرش حصة قديمة (ADR-0040).
  @Column({ name: 'technician_level', type: 'varchar' })
  technicianLevel: string;

  @Column({ name: 'share_weight', type: 'numeric', precision: 5, scale: 2 })
  shareWeight: string;

  @Column({ name: 'pool_cents', type: 'integer' })
  poolCents: number;

  @Column({ name: 'share_cents', type: 'integer' })
  shareCents: number;

  @Column({ name: 'calculation_method', type: 'varchar', length: 30, default: 'weighted_pool' })
  calculationMethod: 'weighted_pool' | 'assistant_level_wage' | 'earnings_policy_v2' | 'manual_override';

  @Column({ name: 'assistant_base_wage_cents', type: 'integer', nullable: true })
  assistantBaseWageCents: number | null;

  @Column({ name: 'assistant_level_multiplier', type: 'numeric', precision: 5, scale: 2, nullable: true })
  assistantLevelMultiplier: string | null;

  @Column({ name: 'assistant_target_cents', type: 'integer', nullable: true })
  assistantTargetCents: number | null;

  @Column({ name: 'settlement_policy_version', type: 'smallint', default: 1 })
  settlementPolicyVersion: 1 | 2;

  @Column({ name: 'calculation_algorithm_version', type: 'varchar', length: 40, nullable: true })
  calculationAlgorithmVersion: string | null;

  @Column({ name: 'technician_kind_snapshot', type: 'varchar', length: 20, nullable: true })
  technicianKindSnapshot: 'technician' | 'assistant' | null;

  @Column({ name: 'earning_role', type: 'varchar', length: 20, nullable: true })
  earningRole: 'technician' | 'assistant' | null;

  @Column({ name: 'level_weight_bps_snapshot', type: 'integer', nullable: true })
  levelWeightBpsSnapshot: number | null;

  @Column({ name: 'assistant_ratio_bps_snapshot', type: 'integer', nullable: true })
  assistantRatioBpsSnapshot: number | null;

  @Column({ name: 'service_skill_snapshot', type: 'varchar', nullable: true })
  serviceSkillSnapshot: string | null;

  @Column({ name: 'service_skill_factor_bps_snapshot', type: 'integer', nullable: true })
  serviceSkillFactorBpsSnapshot: number | null;

  @Column({ name: 'individual_adjustment_bps_snapshot', type: 'integer', nullable: true })
  individualAdjustmentBpsSnapshot: number | null;

  @Column({ name: 'order_adjustment_bps_snapshot', type: 'integer', nullable: true })
  orderAdjustmentBpsSnapshot: number | null;

  @Column({ name: 'effective_weight_units', type: 'numeric', precision: 40, scale: 0, nullable: true })
  effectiveWeightUnits: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
