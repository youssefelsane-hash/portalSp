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
  calculationMethod: 'weighted_pool' | 'assistant_level_wage';

  @Column({ name: 'assistant_base_wage_cents', type: 'integer', nullable: true })
  assistantBaseWageCents: number | null;

  @Column({ name: 'assistant_level_multiplier', type: 'numeric', precision: 5, scale: 2, nullable: true })
  assistantLevelMultiplier: string | null;

  @Column({ name: 'assistant_target_cents', type: 'integer', nullable: true })
  assistantTargetCents: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
