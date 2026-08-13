import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export interface UnmetRequirement {
  key: string;
  labelAr: string;
  currentValue: number | null;
  requiredValue: number;
  comparator: 'gte' | 'lte';
}

export type ProgressionAdminDecision = 'approved' | 'rejected';

@Entity('technician_progression_status')
export class TechnicianProgressionStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'current_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level' })
  currentLevel: TechnicianLevel;

  @Column({ name: 'next_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level', nullable: true })
  nextLevel: TechnicianLevel | null;

  @Index()
  @Column({ name: 'is_eligible', type: 'boolean', default: false })
  isEligible: boolean;

  @Column({ name: 'unmet_requirements', type: 'jsonb', default: [] })
  unmetRequirements: UnmetRequirement[];

  @Column({ name: 'progress', type: 'jsonb', default: {} })
  progress: Record<string, number>;

  @Column({ name: 'eligible_since', type: 'timestamptz', nullable: true })
  eligibleSince: Date | null;

  @Column({ name: 'needs_demotion_review', type: 'boolean', default: false })
  needsDemotionReview: boolean;

  @Column({ name: 'demotion_review_reason', type: 'text', nullable: true })
  demotionReviewReason: string | null;

  @Column({ name: 'admin_decision', type: 'varchar', length: 20, nullable: true })
  adminDecision: ProgressionAdminDecision | null;

  @Column({ name: 'admin_decision_by_user_id', type: 'uuid', nullable: true })
  adminDecisionByUserId: string | null;

  @Column({ name: 'admin_decision_at', type: 'timestamptz', nullable: true })
  adminDecisionAt: Date | null;

  @Column({ name: 'admin_decision_reason', type: 'text', nullable: true })
  adminDecisionReason: string | null;

  @Column({ name: 'last_evaluated_at', type: 'timestamptz' })
  lastEvaluatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
