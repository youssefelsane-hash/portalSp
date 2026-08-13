import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

@Entity('technician_progression_rules')
export class TechnicianProgressionRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'from_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level', unique: true })
  fromLevel: TechnicianLevel;

  @Column({ name: 'to_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level' })
  toLevel: TechnicianLevel;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'auto_promote', type: 'boolean', default: false })
  autoPromote: boolean;

  @Column({ name: 'min_completed_orders', type: 'integer', default: 0 })
  minCompletedOrders: number;

  @Column({ name: 'min_platform_revenue_cents', type: 'bigint', default: 0 })
  minPlatformRevenueCents: string;

  @Column({ name: 'min_avg_rating', type: 'numeric', precision: 3, scale: 2, nullable: true })
  minAvgRating: string | null;

  @Column({ name: 'max_cancellation_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  maxCancellationRate: string | null;

  @Column({ name: 'max_upheld_complaints', type: 'integer', nullable: true })
  maxUpheldComplaints: number | null;

  @Column({ name: 'min_avg_kpi_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  minAvgKpiScore: string | null;

  @Column({ name: 'min_kpi_months_count', type: 'smallint', default: 1 })
  minKpiMonthsCount: number;

  @Column({ name: 'min_days_active', type: 'integer', default: 0 })
  minDaysActive: number;

  @Column({ name: 'enable_demotion_review', type: 'boolean', default: false })
  enableDemotionReview: boolean;

  @Column({ name: 'demotion_review_max_cancellation_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  demotionReviewMaxCancellationRate: string | null;

  @Column({ name: 'demotion_review_min_avg_rating', type: 'numeric', precision: 3, scale: 2, nullable: true })
  demotionReviewMinAvgRating: string | null;

  @Column({ name: 'demotion_review_max_upheld_complaints', type: 'integer', nullable: true })
  demotionReviewMaxUpheldComplaints: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
