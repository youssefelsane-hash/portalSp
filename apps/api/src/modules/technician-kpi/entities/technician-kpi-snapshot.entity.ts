import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export enum KpiSnapshotStatus {
  CALCULATED = 'calculated',
  APPROVED = 'approved',
  PAID = 'paid',
  REJECTED = 'rejected',
}

export interface KpiDimensionScores {
  rating?: number;
  cancellation?: number;
  complaints?: number;
  acceptance?: number;
  completion?: number;
  revenue?: number;
}

export interface KpiWeightsApplied {
  rating: number;
  cancellation: number;
  complaints: number;
  acceptance: number;
  completion: number;
  revenue: number;
}

@Entity('technician_kpi_snapshots')
@Unique(['technicianId', 'periodYear', 'periodMonth'])
export class TechnicianKpiSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Index()
  @Column({ name: 'period_year', type: 'smallint' })
  periodYear: number;

  @Column({ name: 'period_month', type: 'smallint' })
  periodMonth: number;

  @Column({ name: 'offered_orders_count', type: 'integer', default: 0 })
  offeredOrdersCount: number;

  @Column({ name: 'accepted_orders_count', type: 'integer', default: 0 })
  acceptedOrdersCount: number;

  @Column({ name: 'completed_orders_count', type: 'integer', default: 0 })
  completedOrdersCount: number;

  @Column({ name: 'technician_cancelled_count', type: 'integer', default: 0 })
  technicianCancelledCount: number;

  @Column({ name: 'acceptance_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  acceptanceRate: string | null;

  @Column({ name: 'completion_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  completionRate: string | null;

  @Column({ name: 'cancellation_rate', type: 'numeric', precision: 5, scale: 2, nullable: true })
  cancellationRate: string | null;

  @Column({ name: 'average_rating', type: 'numeric', precision: 4, scale: 2, nullable: true })
  averageRating: string | null;

  @Column({ name: 'ratings_count', type: 'integer', default: 0 })
  ratingsCount: number;

  @Column({ name: 'negative_ratings_count', type: 'integer', default: 0 })
  negativeRatingsCount: number;

  @Column({ name: 'average_cleanliness_rating', type: 'numeric', precision: 4, scale: 2, nullable: true })
  averageCleanlinessRating: string | null;

  @Column({ name: 'complaints_count', type: 'integer', default: 0 })
  complaintsCount: number;

  @Column({ name: 'complaints_upheld_count', type: 'integer', default: 0 })
  complaintsUpheldCount: number;

  @Column({ name: 'serious_upheld_complaint', type: 'boolean', default: false })
  seriousUpheldComplaint: boolean;

  @Column({ name: 'revisit_count', type: 'integer', default: 0 })
  revisitCount: number;

  @Column({ name: 'platform_revenue_cents', type: 'bigint', default: 0 })
  platformRevenueCents: string;

  @Column({ name: 'technician_earnings_cents', type: 'bigint', default: 0 })
  technicianEarningsCents: string;

  @Column({ name: 'order_value_cents', type: 'bigint', default: 0 })
  orderValueCents: string;

  @Column({ name: 'is_eligible', type: 'boolean', default: false })
  isEligible: boolean;

  @Column({ name: 'ineligibility_reason', type: 'text', nullable: true })
  ineligibilityReason: string | null;

  @Column({ name: 'dimension_scores', type: 'jsonb', default: {} })
  dimensionScores: KpiDimensionScores;

  @Column({ name: 'weights_applied', type: 'jsonb', default: {} })
  weightsApplied: KpiWeightsApplied;

  @Column({ name: 'overall_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  overallScore: string | null;

  @Column({ name: 'suggested_bonus_cents', type: 'integer', nullable: true })
  suggestedBonusCents: number | null;

  @Index()
  @Column({ name: 'status', type: 'enum', enum: KpiSnapshotStatus, enumName: 'kpi_snapshot_status', default: KpiSnapshotStatus.CALCULATED })
  status: KpiSnapshotStatus;

  @Column({ name: 'approved_bonus_cents', type: 'integer', nullable: true })
  approvedBonusCents: number | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approval_notes', type: 'text', nullable: true })
  approvalNotes: string | null;

  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'wallet_credit_tx_id', type: 'uuid', nullable: true })
  walletCreditTxId: string | null;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
